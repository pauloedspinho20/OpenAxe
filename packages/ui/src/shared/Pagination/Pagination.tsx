import { HardwareButton } from '../../primitives/HardwareButton/HardwareButton'
import { ChevronLeftIcon, ChevronRightIcon } from '../../icons/GeneraIcons'
import styles from './Pagination.module.css'

export interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  className?: string
}

export function Pagination({ page, totalPages, onPageChange, className }: PaginationProps) {
  if (totalPages <= 1) return null

  return (
    <nav className={`${styles.pagination} ${className ?? ''}`.trim()} aria-label="Pagination">
      <HardwareButton
        label="Previous page"
        iconOnly
        icon={<ChevronLeftIcon size={12} />}
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      />
      <span className={`label ${styles.pageInfo}`}>
        {page} / {totalPages}
      </span>
      <HardwareButton
        label="Next page"
        iconOnly
        icon={<ChevronRightIcon size={12} />}
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      />
    </nav>
  )
}
