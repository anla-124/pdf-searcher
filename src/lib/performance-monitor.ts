import { createServiceClient } from '@/lib/supabase/server'

export interface PerformanceMetrics {
  query_time: number
  total_documents: number
  processing_queue_size: number
  avg_processing_time: number
  system_health: 'healthy' | 'degraded' | 'unhealthy'
}

export class PerformanceMonitor {
  private static metrics: PerformanceMetrics[] = []
  private static readonly MAX_METRICS = 100 // Keep last 100 measurements

  /**
   * Record a performance measurement (simplified)
   */
  static async recordMetric(type: string, value: number, metadata?: any) {
    try {
      const timestamp = new Date().toISOString()
      const metric = {
        type,
        value,
        timestamp,
        metadata: metadata || {}
      }

      // Simple in-memory storage
      this.metrics.push(metric as any)
      
      // Keep only the last MAX_METRICS
      if (this.metrics.length > this.MAX_METRICS) {
        this.metrics.shift()
      }

      console.log(`📊 Performance metric recorded: ${type} = ${value}`)
    } catch (error) {
      console.warn('Failed to record performance metric:', error)
    }
  }

  /**
   * Get basic performance metrics
   */
  static async getMetrics(): Promise<PerformanceMetrics> {
    try {
      const supabase = await createServiceClient()
      
      // Get document count
      const { count: totalDocs } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })

      // Simple health check based on document count
      const systemHealth: 'healthy' | 'degraded' | 'unhealthy' = 
        (totalDocs || 0) < 10000 ? 'healthy' : 'degraded'

      return {
        query_time: 50, // Default reasonable value
        total_documents: totalDocs || 0,
        processing_queue_size: 0, // No queue in simplified architecture
        avg_processing_time: 30000, // 30 seconds default
        system_health: systemHealth
      }
    } catch (error) {
      console.error('Failed to get performance metrics:', error)
      return {
        query_time: 0,
        total_documents: 0,
        processing_queue_size: 0,
        avg_processing_time: 0,
        system_health: 'unhealthy'
      }
    }
  }

  /**
   * Get recent metrics
   */
  static getRecentMetrics(): any[] {
    return this.metrics.slice(-10) // Return last 10 metrics
  }
}