# packages/vst3

Placeholder for the VST3/CLAP/AU plugin built with iPlug2, linking directly
against `packages/core`'s C++ DSP engine (#16). No plugin code lives here yet.

This README currently carries the one design decision #16's phase-0 work had
to settle before any parameter code could be written: how a dynamic grid rig
presents a fixed, session-stable parameter list to hosts.

---

## Design note: the automation-parameter slot map (issue #121)

### The problem

VST3, AU and CLAP all require the parameter list to be **fixed and stable**:
declared once at construction, with ids that persist across sessions so a
host's automation lanes keep pointing at the same control. `packages/core`
addresses params as `(block_id, index)` on a **dynamic** 4×10 grid - block
ids are handed out at `nam_studio_add_block` time and each cell's param table
depends on what block kind currently sits there. Nothing about that is stable
across a project reload, and #119 deliberately made param _indices_ an
implementation detail (rig-state documents key by symbol).

### Alternatives considered

1. **One host param per possible control (40 cells × max params).**
   Every cell of the grid reserves a full param table up front; host id
   `(row, col, param)` is purely positional. Rejected: with EQ-sized tables
   that is ~480 declared parameters before globals, which several hosts and
   every automation UI handle badly; ~90% of them would sit dead over any
   empty cell; and it hard-wires the grid dimensions into the plugin ABI,
   making a future grid resize an id-breaking event.

2. **Dynamic parameter lists where the format allows (CLAP), static elsewhere.**
   CLAP supports rescanning the parameter list at runtime, so the plugin could
   mirror the rig exactly and rebuild the list on every topology change.
   Rejected as the primary design: it forks behaviour per format, and the
   formats we most need (VST3, AU) are precisely the ones whose lists must be
   static. A CLAP build can still _simulate_ this design cheaply (rescan after
   rebinds), so choosing the static pool costs CLAP nothing.

3. **Fixed slot pool (chosen).** A small, fixed pool of slots mediates between
   the host's frozen id space and the engine's dynamic one. Hosts see a
   constant parameter list forever; users assign slots to blocks in the
   editor; rebinds change what existing ids mean (with title-change
   notifications) rather than adding/removing ids.

The slot pool is the only alternative that satisfies every constraint at once:
static list at construction (all three formats), ids that persist across
sessions (automation lanes survive), bounded count (no 480-param spam), and no
grid-size coupling.

### The design

- **Pool**: `NAM_STUDIO_AUTOMATION_SLOT_COUNT = 16` slots. Slot 0 is
  permanently the master bus (level, mute); slots 1..15 bind to live blocks -
  more than any realistic rig fills, far fewer than 480.
- **Entries per slot**: `NAM_STUDIO_AUTOMATION_PARAMS_PER_SLOT = 20`, a frozen
  stride. Each entry of a bound slot _is_ an index into the bound block's
  param table; its display name, range and unit resolve dynamically from
  `nam_studio_automation_slot_param_info` (which forwards to the bound
  block's `nam_studio_block_param_info`). Unbound slots expose dead entries;
  entries past the bound block's own table resolve to nothing.
- **Host id layout** (`packages/vst3/generated/automation_param_map.h`,
  generated): id 0 = master level, id 1 = master mute, then slot-major:

      SlotParamId(slot, entry) = 2 + (slot - 1) * 20 + entry

  Total declared parameters: 2 + 15 × 20 = **302**.

- **Normalization**: values cross the plugin/host boundary as 0..1 and map
  linearly onto the resolved param's `[min, max]` (from the schema / live
  param info). Native units never leave core. This is also what makes one
  lane meaningful across different target ranges.

#### Why 20 entries per slot, not 12

The issue proposed "Param 1..12" believing EQ's 12-param table was the widest.
Validation against `param_schema.json` found the real maximum: **reverb-hall
exposes 18 params** (room 17, plate 9). A 12-entry slot would silently leave
reverb tails unautomatable, and picking which 12 by hand would bake index-
order assumptions back into the ABI. So the stride is schema-driven and set
with headroom (20 > 18 today); the generator
(`scripts/gen-param-schema.mjs`) fails if any kind/variant ever exceeds it.

**Both numbers are frozen API surface.** Changing `paramsPerSlot` shifts
every id above the first slot; changing `slotCount` adds ids but also moves
nothing existing (append-only) - still treated as breaking until #127 decides
the chunk-migration story. If a kind genuinely outgrows 20 params, that is a
versioned-layout event: bump the number, bump the plugin's own state-chunk
version, migrate on load.

#### Value semantics across rebinds

Each slot remembers the last normalized value written through it per entry
("dirty" entries). Writes go straight through to the bound block (mapped
through its live ranges); reads resolve live from the bound block, so knob
moves made outside the slot surface (web UI, desktop bridge) show up host-side
too. On **rebind**, only dirty entries re-apply onto the new target - through
the new target's own ranges. Consequences:

- An automation lane's position survives rebinding to a different kind without
  jumping (0.25 stays 0.25; threshold −45 dB becomes delay time 257.5 ms).
- A first-time binding never stomps the new block's existing values with
  zeros - untouched entries stay untouched.
- Removing a block unbinds its slot immediately (never dangles); remembered
  values survive for a later rebind.

Host integration contract on rebind: fire the format's parameter-title-change
mechanism - VST3 `restartComponent(kParamTitlesChanged)`,
AU `kAudioUnitProperty_ParameterList` changed notification,
CLAP `params_rescan(CLAP_PARAM_RESCAN_VALUES | CLAP_PARAM_RESCAN_TEXT)`.

#### Stability contract (the fine print)

Slot addressing pins TWO things as permanent API:

1. The constants above (count, stride).
2. **Per-kind param-table order.** Entry 3 of a slot bound to a compressor is
   compressor param index 3 - today "Attack". If a core release reordered a
   kind's table, saved projects' lanes would land on different controls of the
   same block. That was free to do before (#119 made documents symbol-keyed
   precisely so internal order wouldn't leak); from now on each kind's row
   order in `param_schema.json` is API surface and may only ever be appended
   to. Symbol-keyed rig-state serialization (#119) is unaffected either way.

#### Where everything lives

| Artifact                                                                                                                                                                             | Role                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `param_schema.json` → `"pluginAutomation"`                                                                                                                                           | Single source of truth: counts + master descriptors                                                                   |
| `scripts/gen-param-schema.mjs --target=automation-map`                                                                                                                               | Renders the header below; validates kinds fit the stride                                                              |
| `generated/automation_param_map.h` (this package)                                                                                                                                    | Plugin-side constants, id layout helper, master metadata, static_asserts pinning core's copies                        |
| `packages/core/include/nam_studio/engine.h` → `kAutomation*` / `kMasterAutomation*`                                                                                                  | Core's mirrored constants (asserted equal to the generated ones)                                                      |
| ABI: `nam_studio_bind_automation_slot`, `_unbind_…`, `_automation_slot_block`, `_automation_slot_param_count`, `_automation_slot_param_info`, `_set/get_automation_param_normalized` | Everything a plugin wrapper needs                                                                                     |
| Rig state `"automationSlots"`                                                                                                                                                        | Bindings ride the document (`{"<slot>": {"blockId": "<doc id>"}}`); restored after blocks, soft-skipped when dangling |

Tests: `packages/core/tests/api_automation_slots_test.cpp` - rebind survival
across kinds, save/reload landing on the same control, master immutability,
dynamic resolution, removal/clear unbinding, clamping, malformed-document
tolerance, and byte-stable serialization with bindings present.
