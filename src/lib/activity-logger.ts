// =====================================================
// ACTIVITY LOGGING SERVICE
// =====================================================
// Simple activity tracking for user actions
// Tracks: who, what, when, which document
// =====================================================

import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

// Activity types that we track
export type ActivityAction = 
  | 'upload' 
  | 'delete' 
  | 'search' 
  | 'download' 
  | 'view'
  | 'similarity'
  | 'batch_delete'
  | 'login'
  | 'logout'
  | 'error'

export type ResourceType = 
  | 'document' 
  | 'search' 
  | 'system' 
  | 'auth'
  | 'admin'

const ACTIVITY_ACTION_VALUES: ActivityAction[] = [
  'upload',
  'delete',
  'search',
  'download',
  'view',
  'similarity',
  'batch_delete',
  'login',
  'logout',
  'error'
]

const isActivityAction = (value: unknown): value is ActivityAction =>
  typeof value === 'string' && ACTIVITY_ACTION_VALUES.includes(value as ActivityAction)

const RESOURCE_TYPE_VALUES: ResourceType[] = ['document', 'search', 'system', 'auth', 'admin']

const isResourceType = (value: unknown): value is ResourceType =>
  typeof value === 'string' && RESOURCE_TYPE_VALUES.includes(value as ResourceType)

export interface ActivityLogEntry {
  // User information
  userId?: string
  userEmail?: string
  userIp?: string
  userAgent?: string
  
  // Action details
  action: ActivityAction
  resourceType: ResourceType
  resourceId?: string
  resourceName?: string
  
  // Context and metadata
  details?: Record<string, unknown>
  endpoint?: string
  method?: string
  statusCode?: number
  
  // Timing
  durationMs?: number
}

export interface ActivityFilter {
  userId?: string
  action?: ActivityAction
  resourceType?: ResourceType
  startDate?: Date
  endDate?: Date
  limit?: number
  offset?: number
}

export interface ActivityStats {
  totalActions: number
  uniqueUsers: number
  uploads: number
  deletes: number
  searches: number
  downloads: number
  avgDurationMs: number
}

interface ActivityLogRecord {
  user_uuid: string | null
  email: string | null
  ip_address: string | null
  user_agent: string | null
  action_type: ActivityAction
  resource_type: ResourceType
  resource_uuid: string | null
  resource_name: string | null
  metadata: Record<string, unknown> | null
  api_endpoint: string | null
  http_method: string | null
  response_status: number | null
  duration_ms: number | null
  logged_at: string
}

interface ActivitySummaryRow {
  user_uuid: string | null
  email: string | null
  action_type: ActivityAction
  logged_at: string
}

interface ActivityStatRow {
  action_type: ActivityAction
  user_uuid: string | null
  duration_ms: number | null
}

interface DailyActivityRow {
  action_type: ActivityAction
  logged_at: string
}

export class ActivityLogger {
  private static instance: ActivityLogger
  private enabled: boolean = true

  private constructor() {
    logger.info('Activity logger initialized', {
      component: 'activity-logger'
    })
  }

  static getInstance(): ActivityLogger {
    if (!ActivityLogger.instance) {
      ActivityLogger.instance = new ActivityLogger()
    }
    return ActivityLogger.instance
  }

  // Extract user information from request
  private extractUserInfo(request?: NextRequest): {
    userIp?: string
    userAgent?: string
    userId?: string
    userEmail?: string
  } {
    if (!request) return {}

    const userIp = this.getClientIP(request)
    const userAgent = request.headers.get('user-agent')
    
    // Try to get user info from headers or session
    // This is a basic implementation - you might get this from your auth system
    const userId = request.headers.get('x-user-id')
    const userEmail = request.headers.get('x-user-email')

    const result: {
      userIp?: string
      userAgent?: string
      userId?: string
      userEmail?: string
    } = { userIp }
    
    if (userAgent) result.userAgent = userAgent
    if (userId) result.userId = userId
    if (userEmail) result.userEmail = userEmail
    
    return result
  }

  private getClientIP(request: NextRequest): string {
    const xForwardedFor = request.headers.get('x-forwarded-for')
    const xRealIP = request.headers.get('x-real-ip')
    const cfConnectingIP = request.headers.get('cf-connecting-ip')
    
    if (cfConnectingIP) return cfConnectingIP
    if (xRealIP) return xRealIP
    if (xForwardedFor) return xForwardedFor.split(',')[0]?.trim() || 'unknown'
    
    return 'unknown'
  }

  // Log an activity
  async logActivity(entry: ActivityLogEntry, request?: NextRequest): Promise<void> {
    if (!this.enabled) return

    try {
      const supabase = await createServiceClient()
      const userInfo = this.extractUserInfo(request)

      const activityRecord = {
        user_uuid: entry.userId || userInfo.userId,
        email: entry.userEmail || userInfo.userEmail,
        ip_address: entry.userIp || userInfo.userIp,
        user_agent: entry.userAgent || userInfo.userAgent,
        action_type: entry.action,
        resource_type: entry.resourceType,
        resource_uuid: entry.resourceId,
        resource_name: entry.resourceName,
        metadata: entry.details ? entry.details : null,
        api_endpoint: entry.endpoint,
        http_method: entry.method,
        response_status: entry.statusCode,
        duration_ms: entry.durationMs,
        logged_at: new Date().toISOString()
      }

      const { error } = await supabase
        .from('user_activity_logs')
        .insert(activityRecord)

      if (error) {
        logger.error('Failed to log activity', error, {
          action: entry.action,
          resourceType: entry.resourceType,
          component: 'activity-logger'
        })
      } else {
        const logData: {
          action: ActivityAction
          resourceType: ResourceType
          component: string
          userId?: string
        } = {
          action: entry.action,
          resourceType: entry.resourceType,
          component: 'activity-logger'
        }
        if (activityRecord.user_uuid) {
          logData.userId = activityRecord.user_uuid
        }
        logger.debug('Activity logged', logData)
      }

    } catch (error) {
      logger.error('Activity logging error', error as Error, {
        action: entry.action,
        component: 'activity-logger'
      })
    }
  }

  // Get recent activities
  async getRecentActivities(filter: ActivityFilter = {}): Promise<ActivityLogRecord[]> {
    try {
      const supabase = await createServiceClient()
      
      let query = supabase
        .from('user_activity_recent')
        .select('*')

      // Apply filters
      if (filter.userId) {
        query = query.eq('user_uuid', filter.userId)
      }
      
      if (filter.action) {
        query = query.eq('action_type', filter.action)
      }
      
      if (filter.resourceType) {
        query = query.eq('resource_type', filter.resourceType)
      }
      
      if (filter.startDate) {
        query = query.gte('logged_at', filter.startDate.toISOString())
      }
      
      if (filter.endDate) {
        query = query.lte('logged_at', filter.endDate.toISOString())
      }

      // Apply pagination
      const limit = filter.limit || 50
      const offset = filter.offset || 0
      
      query = query
        .order('logged_at', { ascending: false })
        .range(offset, offset + limit - 1)

      const { data, error } = await query.returns<ActivityLogRecord[]>()

      if (error) {
        logger.error('Failed to fetch recent activities', error, {
          component: 'activity-logger'
        })
        return []
      }

      const records: ActivityLogRecord[] = Array.isArray(data)
        ? data.map(entry => ({
            user_uuid: typeof entry.user_uuid === 'string' ? entry.user_uuid : null,
            email: typeof entry.email === 'string' ? entry.email : null,
            ip_address: typeof entry.ip_address === 'string' ? entry.ip_address : null,
            user_agent: typeof entry.user_agent === 'string' ? entry.user_agent : null,
            action_type: isActivityAction(entry.action_type) ? entry.action_type : 'view',
            resource_type: isResourceType(entry.resource_type) ? entry.resource_type : 'system',
            resource_uuid: typeof entry.resource_uuid === 'string' ? entry.resource_uuid : null,
            resource_name: typeof entry.resource_name === 'string' ? entry.resource_name : null,
            metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata as Record<string, unknown> : null,
            api_endpoint: typeof entry.api_endpoint === 'string' ? entry.api_endpoint : null,
            http_method: typeof entry.http_method === 'string' ? entry.http_method : null,
            response_status: typeof entry.response_status === 'number' ? entry.response_status : null,
            duration_ms: typeof entry.duration_ms === 'number' ? entry.duration_ms : null,
            logged_at: typeof entry.logged_at === 'string'
              ? entry.logged_at
              : new Date().toISOString()
          }))
        : []

      return records

    } catch (error) {
      logger.error('Error fetching activities', error as Error, {
        component: 'activity-logger'
      })
      return []
    }
  }

  // Get user activity summary (simplified - no complex views)
  async getUserActivitySummary(): Promise<ActivitySummaryRow[]> {
    try {
      const supabase = await createServiceClient()
      
      // Simple query directly on the table
      const { data, error } = await supabase
        .from('user_activity_logs')
        .select('user_uuid, email, action_type, logged_at')
        .gte('logged_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('logged_at', { ascending: false })
        .limit(100)

      if (error) {
        logger.error('Failed to fetch user activity summary', error, {
          component: 'activity-logger'
        })
        return []
      }

      const summary: ActivitySummaryRow[] = Array.isArray(data)
        ? data.map(entry => ({
            user_uuid: typeof entry.user_uuid === 'string' ? entry.user_uuid : null,
            email: typeof entry.email === 'string' ? entry.email : null,
            action_type: isActivityAction(entry.action_type) ? entry.action_type : 'view',
            logged_at: typeof entry.logged_at === 'string'
              ? entry.logged_at
              : new Date().toISOString()
          }))
        : []

      return summary

    } catch (error) {
      logger.error('Error fetching user summary', error as Error, {
        component: 'activity-logger'
      })
      return []
    }
  }

  // Get daily activity stats (simplified)
  async getDailyActivityStats(days: number = 7): Promise<DailyActivityRow[]> {
    try {
      const supabase = await createServiceClient()
      
      // Simple query - get raw data for last N days
      const { data, error } = await supabase
        .from('user_activity_logs')
        .select('action_type, logged_at')
        .gte('logged_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
        .order('logged_at', { ascending: false })

      if (error) {
        logger.error('Failed to fetch daily activity stats', error, {
          component: 'activity-logger'
        })
        return []
      }

      const rows: DailyActivityRow[] = Array.isArray(data)
        ? data.map(entry => ({
            action_type: isActivityAction(entry.action_type) ? entry.action_type : 'view',
            logged_at: typeof entry.logged_at === 'string'
              ? entry.logged_at
              : new Date().toISOString()
          }))
        : []

      return rows

    } catch (error) {
      logger.error('Error fetching daily stats', error as Error, {
        component: 'activity-logger'
      })
      return []
    }
  }

  // Get overall activity stats
  async getActivityStats(days: number = 30): Promise<ActivityStats> {
    try {
      const supabase = await createServiceClient()
      
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - days)

      const { data, error } = await supabase
        .from('user_activity_logs')
        .select('action_type, user_uuid, duration_ms')
        .gte('logged_at', startDate.toISOString())

      if (error) {
        logger.error('Failed to fetch activity stats', error, {
          component: 'activity-logger'
        })
        return {
          totalActions: 0,
          uniqueUsers: 0,
          uploads: 0,
          deletes: 0,
          searches: 0,
          downloads: 0,
          avgDurationMs: 0
        }
      }

      const activities: ActivityStatRow[] = Array.isArray(data)
        ? data.map(entry => ({
            action_type: isActivityAction(entry.action_type) ? entry.action_type : 'view',
            user_uuid: typeof entry.user_uuid === 'string' ? entry.user_uuid : null,
            duration_ms: typeof entry.duration_ms === 'number' ? entry.duration_ms : null
          }))
        : []
      const uniqueUsers = new Set(activities.map(a => a.user_uuid)).size
      const uploads = activities.filter(a => a.action_type === 'upload').length
      const deletes = activities.filter(a => a.action_type === 'delete').length
      const searches = activities.filter(a => a.action_type === 'search').length
      const downloads = activities.filter(a => a.action_type === 'download').length
      
      const durations = activities
        .map(a => a.duration_ms)
        .filter((duration): duration is number => duration !== null && duration !== undefined)
      const avgDurationMs = durations.length > 0 
        ? durations.reduce((a, b) => a + b, 0) / durations.length 
        : 0

      return {
        totalActions: activities.length,
        uniqueUsers,
        uploads,
        deletes,
        searches,
        downloads,
        avgDurationMs: Math.round(avgDurationMs)
      }

    } catch (error) {
      logger.error('Error calculating activity stats', error as Error, {
        component: 'activity-logger'
      })
      return {
        totalActions: 0,
        uniqueUsers: 0,
        uploads: 0,
        deletes: 0,
        searches: 0,
        downloads: 0,
        avgDurationMs: 0
      }
    }
  }

  // Helper methods for common activities
  async logDocumentUpload(documentId: string, fileName: string, request?: NextRequest): Promise<void> {
    await this.logActivity({
      action: 'upload',
      resourceType: 'document',
      resourceId: documentId,
      resourceName: fileName
    }, request)
  }

  async logDocumentDelete(documentId: string, fileName: string, request?: NextRequest): Promise<void> {
    await this.logActivity({
      action: 'delete',
      resourceType: 'document',
      resourceId: documentId,
      resourceName: fileName
    }, request)
  }

  async logSearch(query: string, resultsCount: number, request?: NextRequest): Promise<void> {
    await this.logActivity({
      action: 'search',
      resourceType: 'search',
      resourceName: query,
      details: { resultsCount }
    }, request)
  }

  async logSimilaritySearch(documentId: string, resultsCount: number, request?: NextRequest): Promise<void> {
    await this.logActivity({
      action: 'similarity',
      resourceType: 'search',
      resourceId: documentId,
      details: { resultsCount }
    }, request)
  }

  async logBatchDelete(documentIds: string[], request?: NextRequest): Promise<void> {
    await this.logActivity({
      action: 'batch_delete',
      resourceType: 'document',
      details: { count: documentIds.length, documentIds }
    }, request)
  }

  // Enable/disable logging
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    logger.info(`Activity logging ${enabled ? 'enabled' : 'disabled'}`, {
      component: 'activity-logger'
    })
  }
}

// Export singleton instance
export const activityLogger = ActivityLogger.getInstance()
export default activityLogger
