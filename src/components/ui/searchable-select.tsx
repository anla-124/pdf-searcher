'use client'

import { useState, useRef, useEffect, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Option {
  value: string
  label: string
}

interface SearchableSelectProps {
  options: Option[]
  value?: string
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  className?: string
  allowClear?: boolean
  emptyMessage?: string
  disablePortal?: boolean
  'data-testid'?: string
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search options...',
  className,
  allowClear = false,
  emptyMessage = 'No options found',
  disablePortal = false,
  'data-testid': dataTestId,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filteredOptions = options.filter(option =>
    option.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
    option.value.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const selectedOption = options.find(option => option.value === value)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      const isClickInside = containerRef.current?.contains(target) || (target as Element)?.closest('[data-dropdown-portal]')
      
      if (!isClickInside) {
        setIsOpen(false)
        setSearchQuery('')
      }
    }

    const handleScroll = () => {
      if (isOpen) {
        updateDropdownPosition()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      window.addEventListener('scroll', handleScroll, true)
      window.addEventListener('resize', handleScroll)
      setTimeout(() => {
        inputRef.current?.focus()
      }, 0)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [isOpen])

  const handleSelect = (optionValue: string) => {
    onValueChange(optionValue)
    setIsOpen(false)
    setSearchQuery('')
  }

  const handleClear = (event: ReactMouseEvent) => {
    event.stopPropagation()
    onValueChange('')
  }

  const updateDropdownPosition = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setDropdownPosition({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
      })
    }
  }

  const toggleDropdown = () => {
    if (!isOpen) {
      updateDropdownPosition()
    }
    setIsOpen(prev => !prev)
  }

  const dropdownContent = (
    <Card
      data-dropdown-portal={!disablePortal ? true : undefined}
      className="p-0 shadow-lg bg-white dark:bg-gray-800 border"
    >
      <div className="p-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      
      <div className="max-h-60 overflow-auto text-left">
        {filteredOptions.length === 0 ? (
          <div className="p-2 text-center text-sm text-muted-foreground">{emptyMessage}</div>
        ) : (
          <div className="p-1">
            {filteredOptions.map(option => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  'relative flex w-full cursor-pointer select-none items-center rounded px-2 py-1.5 text-sm text-left outline-none hover:bg-accent hover:text-accent-foreground',
                  value === option.value && 'bg-accent text-accent-foreground'
                )}
                onMouseDown={event => {
                  event.preventDefault()
                  handleSelect(option.value)
                }}
              >
                <Check className={cn('mr-2 h-4 w-4', value === option.value ? 'opacity-100' : 'opacity-0')} />
                <span className="text-left">{option.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Card>
  )

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={isOpen}
        onClick={toggleDropdown}
        className="w-full justify-between"
        data-testid={dataTestId}
      >
        <span className={cn('truncate', !selectedOption && 'text-muted-foreground')}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <div className="flex items-center gap-1">
          {allowClear && selectedOption && (
            <X className="h-4 w-4 opacity-50 hover:opacity-100" onClick={handleClear} />
          )}
          <ChevronDown className="h-4 w-4 opacity-50" />
        </div>
      </Button>

      {isOpen && (
        disablePortal || typeof window === 'undefined'
          ? (
            <div className="absolute left-0 right-0 z-50 mt-2">{dropdownContent}</div>
          ) : (
            createPortal(
              <div
                className="fixed z-[99999]"
                data-dropdown-portal
                style={{
                  top: dropdownPosition.top,
                  left: dropdownPosition.left,
                  width: dropdownPosition.width,
                  pointerEvents: 'auto',
                }}
              >
                <div data-dropdown-portal>{dropdownContent}</div>
              </div>,
              document.body
            )
          )
      )}
    </div>
  )
}
