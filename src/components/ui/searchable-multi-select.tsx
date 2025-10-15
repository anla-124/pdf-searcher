'use client'

import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Option {
  value: string
  label: string
}

interface SearchableMultiSelectProps {
  options: ReadonlyArray<Option>
  values: string[]
  onValuesChange: (values: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  className?: string
  emptyMessage?: string
}

export function SearchableMultiSelect({
  options,
  values,
  onValuesChange,
  placeholder = "Select...",
  searchPlaceholder = "Search options...",
  className,
  emptyMessage = "No options found"
}: SearchableMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filteredOptions = options.filter(option =>
    option.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
    option.value.toLowerCase().includes(searchQuery.toLowerCase())
  )

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      const isClickInside = containerRef.current?.contains(target) || 
                           (target as Element)?.closest('[data-dropdown-portal]')
      
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
      // Focus the search input when opened
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

  const handleToggleOption = (optionValue: string) => {
    const newValues = values.includes(optionValue)
      ? values.filter(v => v !== optionValue)
      : [...values, optionValue]
    onValuesChange(newValues)
  }

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    onValuesChange([])
  }

  const updateDropdownPosition = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setDropdownPosition({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width
      })
    }
  }

  const toggleDropdown = () => {
    if (!isOpen) {
      updateDropdownPosition()
    }
    setIsOpen(!isOpen)
  }

  const getDisplayText = () => {
    if (values.length === 0) return placeholder
    if (values.length === 1) {
      const option = options.find(opt => opt.value === values[0])
      return option?.label || values[0]
    }
    return `${values.length} selected`
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={isOpen}
        onClick={toggleDropdown}
        className="w-full justify-between text-xs h-8"
      >
        <span className={cn("truncate", values.length === 0 && "text-muted-foreground")}>
          {getDisplayText()}
        </span>
        <div className="flex items-center gap-1">
          {values.length > 0 && (
            <X
              className="h-3 w-3 opacity-50 hover:opacity-100"
              onClick={handleClearAll}
            />
          )}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </div>
      </Button>

      {isOpen && typeof window !== 'undefined' && createPortal(
        <Card 
          data-dropdown-portal
          className="fixed z-[99999] p-0 shadow-lg bg-white dark:bg-gray-800 border-2" 
          style={{ 
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            width: dropdownPosition.width,
            zIndex: 99999
          }}
        >
          <div className="p-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-7 text-xs"
              />
            </div>
          </div>
          
          <div className="max-h-60 overflow-auto">
            {filteredOptions.length === 0 ? (
              <div className="p-2 text-center text-xs text-muted-foreground">
                {emptyMessage}
              </div>
            ) : (
              <div className="p-1">
                {filteredOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      "relative flex w-full cursor-pointer select-none items-center rounded px-2 py-1.5 text-xs outline-none hover:bg-accent hover:text-accent-foreground"
                    )}
                    onClick={() => handleToggleOption(option.value)}
                  >
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={values.includes(option.value)}
                        onChange={() => { /* Handled by onClick above */ }}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-3 w-3"
                        readOnly
                      />
                      <span>{option.label}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>,
        document.body
      )}
    </div>
  )
}
