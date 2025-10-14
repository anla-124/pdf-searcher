'use client'

import React, { useState, useRef } from 'react'
import { Document, SearchFilters } from '@/types'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableMultiSelect } from '@/components/ui/searchable-multi-select'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Search, Loader2, RotateCcw, X, Building, Users, Briefcase, Globe } from 'lucide-react'
import { SimilarityResultsV2 } from './similarity-results-v2'
import {
  LAW_FIRM_OPTIONS,
  FUND_MANAGER_OPTIONS,
  FUND_ADMIN_OPTIONS,
  JURISDICTION_OPTIONS,
} from '@/lib/metadata-constants'
import { clientLogger } from '@/lib/client-logger'

interface SimilaritySearchFormProps {
  documentId: string
  sourceDocument: Document
}

export function SimilaritySearchForm({ documentId, sourceDocument }: SimilaritySearchFormProps) {
  const [isSearching, setIsSearching] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [results, setResults] = useState<any[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [filters, setFilters] = useState<SearchFilters>({
    min_score: 0.7,
    page_range: {
      use_entire_document: true
    }
  })
  const [topK, setTopK] = useState(10)
  const abortControllerRef = useRef<AbortController | null>(null)

  const handleSearch = async () => {
    setIsSearching(true)
    setHasSearched(true)
    
    // Create new AbortController for this search
    abortControllerRef.current = new AbortController()
    
    try {
      const response = await fetch(`/api/documents/${documentId}/similar-v2`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filters,
          stage0_topK: 600, // Stage 0: Wide centroid sweep for high recall
          stage1_topK: 250, // Stage 1: Preserve broad candidate set for Stage 2
          stage2_fallbackThreshold: 0.8,
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error('Failed to search for similar documents')
      }

      const data = await response.json()
      setResults(data.results)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        clientLogger.warn('Search cancelled by user')
        setResults([])
      } else {
        clientLogger.error('Similarity search error', error)
        alert('Failed to search for similar documents. Please try again.')
      }
    } finally {
      setIsSearching(false)
      abortControllerRef.current = null
    }
  }

  const handleStopSearch = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setIsSearching(false)
    }
  }

  const resetSearch = () => {
    setResults([])
    setHasSearched(false)
    setFilters({ 
      min_score: 0.7,
      page_range: {
        use_entire_document: true
      }
    })
    setTopK(10)
  }

  return (
    <div className="space-y-6">
      {/* Search Form */}
      <Card className="card-enhanced">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Similarity Search
              </CardTitle>
              <CardDescription>
                Search documents similar to &quot;{sourceDocument.title}&quot;
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={resetSearch}
              disabled={!hasSearched}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Page Range Selection */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Search Scope</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={filters.page_range?.use_entire_document ? "default" : "outline"}
                size="sm"
                onClick={() => setFilters(prev => ({
                  ...prev,
                  page_range: {
                    ...prev.page_range,
                    use_entire_document: true
                  }
                }))}
              >
                Search entire document
              </Button>
              <Button
                type="button"
                variant={!filters.page_range?.use_entire_document ? "default" : "outline"}
                size="sm"
                onClick={() => setFilters(prev => ({
                  ...prev,
                  page_range: {
                    ...prev.page_range,
                    use_entire_document: false
                  }
                }))}
              >
                Search specific page range
              </Button>
              {!filters.page_range?.use_entire_document && (
                <>
                  <Input
                    id="startPage"
                    type="number"
                    min="1"
                    placeholder="From"
                    className="h-8 w-24"
                    value={filters.page_range?.start_page || ''}
                    onChange={(e) => setFilters(prev => ({
                      ...prev,
                      page_range: {
                        ...prev.page_range,
                        start_page: e.target.value ? parseInt(e.target.value) : 1
                      }
                    }))}
                  />
                  <Input
                    id="endPage"
                    type="number"
                    min="1"
                    placeholder="To"
                    className="h-8 w-24"
                    value={filters.page_range?.end_page || ''}
                    onChange={(e) => setFilters(prev => ({
                      ...prev,
                      page_range: {
                        ...prev.page_range,
                        end_page: e.target.value ? parseInt(e.target.value) : 1
                      }
                    }))}
                  />
                </>
              )}
            </div>
          </div>

          {/* Business Metadata Filters */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Filters</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label className="flex items-center gap-1 text-xs">
                  <Building className="h-3 w-3" />
                  Law Firm
                </Label>
                <SearchableMultiSelect
                  options={LAW_FIRM_OPTIONS}
                  values={filters.law_firm ?? []}
                  onValuesChange={(values) =>
                    setFilters(prev => ({
                      ...prev,
                      law_firm: values
                    }))
                  }
                  placeholder="Any law firm"
                  searchPlaceholder="Search law firms..."
                  className="h-7 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="flex items-center gap-1 text-xs">
                  <Users className="h-3 w-3" />
                  Fund Manager
                </Label>
                <SearchableMultiSelect
                  options={FUND_MANAGER_OPTIONS}
                  values={filters.fund_manager ?? []}
                  onValuesChange={(values) =>
                    setFilters(prev => ({
                      ...prev,
                      fund_manager: values
                    }))
                  }
                  placeholder="Any fund manager"
                  searchPlaceholder="Search fund managers..."
                  className="h-7 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="flex items-center gap-1 text-xs">
                  <Briefcase className="h-3 w-3" />
                  Fund Admin
                </Label>
                <SearchableMultiSelect
                  options={FUND_ADMIN_OPTIONS}
                  values={filters.fund_admin ?? []}
                  onValuesChange={(values) =>
                    setFilters(prev => ({
                      ...prev,
                      fund_admin: values
                    }))
                  }
                  placeholder="Any fund admin"
                  searchPlaceholder="Search fund admins..."
                  className="h-7 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="flex items-center gap-1 text-xs">
                  <Globe className="h-3 w-3" />
                  Jurisdiction
                </Label>
                <SearchableMultiSelect
                  options={JURISDICTION_OPTIONS}
                  values={filters.jurisdiction ?? []}
                  onValuesChange={(values) =>
                    setFilters(prev => ({
                      ...prev,
                      jurisdiction: values
                    }))
                  }
                  placeholder="Any jurisdiction"
                  searchPlaceholder="Search jurisdictions..."
                  className="h-7 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Search Parameters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="topK" className="text-xs">Number of Results</Label>
              <Select value={topK.toString()} onValueChange={(value) => setTopK(parseInt(value))}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 results</SelectItem>
                  <SelectItem value="10">10 results</SelectItem>
                  <SelectItem value="15">15 results</SelectItem>
                  <SelectItem value="20">20 results</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="minScore" className="text-xs">Minimum Similarity: {Math.round((filters.min_score || 0.7) * 100)}%</Label>
              <div className="px-1 py-1">
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[Math.round((filters.min_score || 0.7) * 100)]}
                  onValueChange={(value) => setFilters(prev => ({ 
                    ...prev, 
                    min_score: (value[0] ?? 70) / 100 
                  }))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>

            <div className="flex items-end gap-2">
              {isSearching ? (
                <>
                  <Button
                    onClick={handleStopSearch}
                    variant="destructive"
                    size="sm"
                    className="flex-1 h-8"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Stop
                  </Button>
                  <Button
                    disabled
                    variant="outline"
                    size="sm"
                    className="flex-1 h-8"
                  >
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Searching...
                  </Button>
                </>
              ) : (
                <Button
                  onClick={handleSearch}
                  size="sm"
                  className="w-full h-8"
                >
                  <Search className="h-3 w-3 mr-1" />
                  Search
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {hasSearched && (
        <SimilarityResultsV2
          results={results}
          sourceDocument={sourceDocument}
          isLoading={isSearching}
        />
      )}
    </div>
  )
}
