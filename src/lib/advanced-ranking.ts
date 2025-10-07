import { createServiceClient } from '@/lib/supabase/server'

interface RankingContext {
  userId: string
  userPreferences?: {
    preferredLawFirms?: string[]
    preferredJurisdictions?: string[]
    recentSearches?: string[]
    documentInteractions?: Record<string, number>
  }
  searchHistory?: {
    query: string
    timestamp: Date
    clickedDocuments: string[]
  }[]
  businessContext?: {
    currentProject?: string
    focusAreas?: string[]
    priorityMetadata?: Record<string, number>
  }
}

interface DocumentScore {
  documentId: string
  baseScore: number
  rankingFactors: {
    relevanceScore: number
    recencyBoost: number
    businessContextBoost: number
    personalizedBoost: number
    qualityScore: number
    diversityPenalty: number
  }
  finalScore: number
  explanation: string[]
}

export class AdvancedRankingEngine {
  
  static async rankResults(
    results: any[],
    query: string,
    context: RankingContext,
    options: {
      enablePersonalization?: boolean
      enableBusinessContext?: boolean
      enableQualityScoring?: boolean
      enableDiversityBoost?: boolean
      maxSimilarDocuments?: number
    } = {}
  ): Promise<DocumentScore[]> {
    
    const {
      enablePersonalization = true,
      enableBusinessContext = true,
      enableQualityScoring = true,
      enableDiversityBoost = true,
      maxSimilarDocuments = 3
    } = options

    console.log(`🎯 Advanced ranking for ${results.length} results`)
    console.log(`📊 Features: personalization=${enablePersonalization}, business=${enableBusinessContext}, quality=${enableQualityScoring}, diversity=${enableDiversityBoost}`)

    const supabase = createServiceClient()
    
    // Get user interaction data for personalization
    const userInteractions = enablePersonalization ? 
      await this.getUserInteractionData(context.userId, supabase) : {}
    
    // Get document quality metrics
    const qualityMetrics = enableQualityScoring ? 
      await this.getDocumentQualityMetrics(results.map(r => r.document.id), supabase) : {}

    const scoredResults: DocumentScore[] = []
    const seenMetadataCombinations = new Set<string>()

    for (const result of results) {
      const document = result.document
      const baseScore = result.score || 0
      
      const rankingFactors = {
        relevanceScore: baseScore,
        recencyBoost: 0,
        businessContextBoost: 0,
        personalizedBoost: 0,
        qualityScore: 0,
        diversityPenalty: 0
      }

      const explanation: string[] = []
      explanation.push(`Base relevance: ${Math.round(baseScore * 100)}%`)

      // 1. Recency Boost
      const recencyBoost = this.calculateRecencyBoost(document.created_at)
      rankingFactors.recencyBoost = recencyBoost
      if (recencyBoost > 0.05) {
        explanation.push(`Recent document: +${Math.round(recencyBoost * 100)}%`)
      }

      // 2. Business Context Boost
      if (enableBusinessContext && context.businessContext) {
        const businessBoost = this.calculateBusinessContextBoost(document, context.businessContext, query)
        rankingFactors.businessContextBoost = businessBoost
        if (businessBoost > 0.05) {
          explanation.push(`Business context match: +${Math.round(businessBoost * 100)}%`)
        }
      }

      // 3. Personalization Boost
      if (enablePersonalization && context.userPreferences) {
        const personalizedBoost = this.calculatePersonalizationBoost(
          document, 
          context.userPreferences, 
          userInteractions[document.id] || 0
        )
        rankingFactors.personalizedBoost = personalizedBoost
        if (personalizedBoost > 0.05) {
          explanation.push(`Personal preference: +${Math.round(personalizedBoost * 100)}%`)
        }
      }

      // 4. Quality Score
      if (enableQualityScoring) {
        const qualityScore = this.calculateQualityScore(document, qualityMetrics[document.id])
        rankingFactors.qualityScore = qualityScore
        if (qualityScore > 0.05) {
          explanation.push(`Document quality: +${Math.round(qualityScore * 100)}%`)
        } else if (qualityScore < -0.05) {
          explanation.push(`Quality concerns: ${Math.round(qualityScore * 100)}%`)
        }
      }

      // 5. Diversity Penalty (reduce similar metadata combinations)
      if (enableDiversityBoost) {
        const metadataKey = this.createMetadataKey(document)
        const similarCount = Array.from(seenMetadataCombinations).filter(key => 
          this.calculateMetadataSimilarity(key, metadataKey) > 0.8
        ).length
        
        if (similarCount >= maxSimilarDocuments) {
          rankingFactors.diversityPenalty = -0.1 * (similarCount - maxSimilarDocuments + 1)
          explanation.push(`Diversity penalty: ${Math.round(rankingFactors.diversityPenalty * 100)}%`)
        }
        seenMetadataCombinations.add(metadataKey)
      }

      // Calculate final score
      const finalScore = Math.max(0, Math.min(1, 
        rankingFactors.relevanceScore +
        rankingFactors.recencyBoost +
        rankingFactors.businessContextBoost +
        rankingFactors.personalizedBoost +
        rankingFactors.qualityScore +
        rankingFactors.diversityPenalty
      ))

      scoredResults.push({
        documentId: document.id,
        baseScore,
        rankingFactors,
        finalScore,
        explanation
      })
    }

    // Sort by final score
    scoredResults.sort((a, b) => b.finalScore - a.finalScore)

    console.log(`✅ Advanced ranking completed`)
    console.log(`📈 Score improvements: ${scoredResults.filter(r => r.finalScore > r.baseScore).length}/${scoredResults.length} documents`)

    return scoredResults
  }

  private static async getUserInteractionData(userId: string, supabase: any): Promise<Record<string, number>> {
    try {
      // This would track user interactions like clicks, downloads, time spent
      // For now, returning empty object - would be implemented based on analytics data
      const { data: interactions } = await supabase
        .from('user_document_interactions')
        .select('document_id, interaction_score')
        .eq('user_id', userId)
        .limit(100)

      const interactionMap: Record<string, number> = {}
      if (interactions) {
        interactions.forEach((interaction: any) => {
          interactionMap[interaction.document_id] = interaction.interaction_score || 0
        })
      }

      return interactionMap
    } catch (error) {
      console.warn('Could not load user interactions:', error)
      return {}
    }
  }

  private static async getDocumentQualityMetrics(documentIds: string[], supabase: any): Promise<Record<string, any>> {
    try {
      const { data: documents } = await supabase
        .from('documents')
        .select('id, file_size, page_count, extracted_text, processing_notes')
        .in('id', documentIds)

      const qualityMap: Record<string, any> = {}
      if (documents) {
        documents.forEach((doc: any) => {
          qualityMap[doc.id] = {
            fileSize: doc.file_size,
            pageCount: doc.page_count,
            textLength: doc.extracted_text?.length || 0,
            processingNotes: doc.processing_notes
          }
        })
      }

      return qualityMap
    } catch (error) {
      console.warn('Could not load document quality metrics:', error)
      return {}
    }
  }

  private static calculateRecencyBoost(createdAt: string): number {
    const docDate = new Date(createdAt)
    const now = new Date()
    const daysDiff = (now.getTime() - docDate.getTime()) / (1000 * 60 * 60 * 24)
    
    // Recent documents get a boost, with decay over time
    if (daysDiff <= 7) return 0.1 // Within a week: +10%
    if (daysDiff <= 30) return 0.05 // Within a month: +5%
    if (daysDiff <= 90) return 0.02 // Within 3 months: +2%
    
    return 0
  }

  private static calculateBusinessContextBoost(
    document: any, 
    businessContext: NonNullable<RankingContext['businessContext']>,
    query: string
  ): number {
    let boost = 0
    
    // Priority metadata boost
    if (businessContext.priorityMetadata) {
      for (const [field, weight] of Object.entries(businessContext.priorityMetadata)) {
        if (document.metadata?.[field]) {
          boost += weight * 0.05 // Up to 5% per priority field
        }
      }
    }
    
    // Focus areas boost
    if (businessContext.focusAreas) {
      const docMetadataString = JSON.stringify(document.metadata).toLowerCase()
      const queryLower = query.toLowerCase()
      
      for (const focusArea of businessContext.focusAreas) {
        if (docMetadataString.includes(focusArea.toLowerCase()) || 
            queryLower.includes(focusArea.toLowerCase())) {
          boost += 0.03 // +3% per matching focus area
        }
      }
    }
    
    return Math.min(boost, 0.15) // Cap at 15%
  }

  private static calculatePersonalizationBoost(
    document: any,
    userPreferences: NonNullable<RankingContext['userPreferences']>,
    interactionScore: number
  ): number {
    let boost = 0
    
    // Interaction history boost
    boost += Math.min(interactionScore * 0.1, 0.1) // Up to 10% for frequently accessed docs
    
    // Preferred law firms
    if (userPreferences.preferredLawFirms && document.metadata?.law_firm) {
      if (userPreferences.preferredLawFirms.includes(document.metadata.law_firm)) {
        boost += 0.05 // +5% for preferred law firm
      }
    }
    
    // Preferred jurisdictions
    if (userPreferences.preferredJurisdictions && document.metadata?.jurisdiction) {
      if (userPreferences.preferredJurisdictions.includes(document.metadata.jurisdiction)) {
        boost += 0.05 // +5% for preferred jurisdiction
      }
    }
    
    return Math.min(boost, 0.2) // Cap at 20%
  }

  private static calculateQualityScore(document: any, qualityMetrics?: any): number {
    if (!qualityMetrics) return 0
    
    let qualityScore = 0
    
    // Text extraction quality
    const textLength = qualityMetrics.textLength || 0
    const pageCount = qualityMetrics.pageCount || 1
    const avgTextPerPage = textLength / pageCount
    
    if (avgTextPerPage > 500) {
      qualityScore += 0.05 // Good text extraction
    } else if (avgTextPerPage < 100) {
      qualityScore -= 0.05 // Poor text extraction (possibly scanned)
    }
    
    // File size reasonableness
    const fileSize = qualityMetrics.fileSize || 0
    const sizePerPage = fileSize / pageCount
    
    if (sizePerPage > 10 * 1024 * 1024) { // > 10MB per page
      qualityScore -= 0.03 // Very large files may be image-heavy
    }
    
    // Processing quality indicators
    if (qualityMetrics.processingNotes?.includes('error')) {
      qualityScore -= 0.1 // Processing errors
    }
    
    return qualityScore
  }

  private static createMetadataKey(document: any): string {
    const metadata = document.metadata || {}
    return `${metadata.law_firm || 'unknown'}:${metadata.fund_manager || 'unknown'}:${metadata.jurisdiction || 'unknown'}`
  }

  private static calculateMetadataSimilarity(key1: string, key2: string): number {
    const parts1 = key1.split(':')
    const parts2 = key2.split(':')
    
    let matches = 0
    for (let i = 0; i < Math.min(parts1.length, parts2.length); i++) {
      if (parts1[i] === parts2[i] && parts1[i] !== 'unknown') {
        matches++
      }
    }
    
    return matches / Math.max(parts1.length, parts2.length)
  }

  // Get ranking weights based on user behavior patterns
  static async getUserRankingPreferences(userId: string): Promise<RankingContext['userPreferences']> {
    try {
      const supabase = await createServiceClient()
      
      // This would analyze user behavior to determine preferences
      // For now, returning some default preferences
      const { data: recentSearches } = await supabase
        .from('search_history')
        .select('query, clicked_documents, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50)

      const preferences: RankingContext['userPreferences'] = {
        recentSearches: recentSearches?.map(s => s.query) || [],
        documentInteractions: {}
      }

      // Analyze clicked documents to infer preferences
      if (recentSearches) {
        const lawFirmCounts: Record<string, number> = {}
        const jurisdictionCounts: Record<string, number> = {}
        
        for (const search of recentSearches) {
          if (search.clicked_documents) {
            // Would analyze metadata of clicked documents
            // This is a simplified implementation
          }
        }
        
        // Set preferred law firms and jurisdictions based on usage patterns
        preferences.preferredLawFirms = Object.entries(lawFirmCounts)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 3)
          .map(([firm]) => firm)
          
        preferences.preferredJurisdictions = Object.entries(jurisdictionCounts)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 3)
          .map(([jurisdiction]) => jurisdiction)
      }

      return preferences
    } catch (error) {
      console.warn('Could not load user ranking preferences:', error)
      return {}
    }
  }

  // Create business context from project information
  static createBusinessContext(
    currentProject?: string,
    focusAreas?: string[],
    priorityFields?: string[]
  ): RankingContext['businessContext'] {
    const priorityMetadata: Record<string, number> = {}
    
    if (priorityFields) {
      priorityFields.forEach((field, index) => {
        priorityMetadata[field] = 1 - (index * 0.2) // Decreasing priority
      })
    }
    
    const result: {
      currentProject?: string
      focusAreas?: string[]
      priorityMetadata?: Record<string, number>
    } = {
      focusAreas: focusAreas || [],
      priorityMetadata
    }
    
    if (currentProject) {
      result.currentProject = currentProject
    }
    
    return result
  }
}