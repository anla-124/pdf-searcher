import { createServerClient } from '@supabase/ssr'
import { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

// Pool configuration - UNLIMITED for enterprise processing
interface PoolConfig {
  minConnections: number
  maxConnections: number
  idleTimeout: number
  connectionTimeout: number
  unlimitedMode: boolean
}

interface PooledConnection {
  client: SupabaseClient
  isActive: boolean
  lastUsed: number
  sessionId?: string
}

interface PoolMetrics {
  activeConnections: number
  idleConnections: number
  totalConnections: number
  waitingRequests: number
  connectionsCreated: number
  connectionsDestroyed: number
}

/**
 * Enterprise-grade Supabase connection pool manager
 * Handles connection reuse, lifecycle management, and resource optimization
 */
export class SupabaseConnectionPool {
  private static instance: SupabaseConnectionPool
  private static isInitialized: boolean = false
  private servicePool: PooledConnection[] = []
  private sessionPools: Map<string, PooledConnection[]> = new Map()
  private config: PoolConfig
  private metrics: PoolMetrics = {
    activeConnections: 0,
    idleConnections: 0,
    totalConnections: 0,
    waitingRequests: 0,
    connectionsCreated: 0,
    connectionsDestroyed: 0
  }
  private cleanupInterval: NodeJS.Timeout | null = null

  private constructor() {
    this.config = {
      minConnections: parseInt(process.env['DB_POOL_MIN_CONNECTIONS'] || '2'),
      maxConnections: parseInt(process.env['DB_POOL_MAX_CONNECTIONS'] || '1000'), // UNLIMITED: 1000 connections
      idleTimeout: parseInt(process.env['DB_POOL_IDLE_TIMEOUT'] || '300000'), // 5 minutes
      connectionTimeout: parseInt(process.env['DB_POOL_CONNECTION_TIMEOUT'] || '0'), // NO TIMEOUT
      unlimitedMode: process.env['UNLIMITED_PROCESSING'] === 'true'
    }

    // Initialize minimum service connections
    this.initializeServicePool()
    
    // Start cleanup worker
    this.startCleanupWorker()
    
    // Only log initialization once
    if (!SupabaseConnectionPool.isInitialized) {
      logger.info('Supabase Connection Pool initialized', {
        mode: this.config.unlimitedMode ? 'UNLIMITED' : 'LIMITED',
        minConnections: this.config.minConnections,
        maxConnections: this.config.unlimitedMode ? 'unlimited' : this.config.maxConnections,
        idleTimeout: this.config.idleTimeout,
        connectionTimeout: this.config.connectionTimeout === 0 ? 'unlimited' : this.config.connectionTimeout
      })
      SupabaseConnectionPool.isInitialized = true
    }
  }

  static getInstance(): SupabaseConnectionPool {
    if (!SupabaseConnectionPool.instance) {
      SupabaseConnectionPool.instance = new SupabaseConnectionPool()
    }
    return SupabaseConnectionPool.instance
  }


  /**
   * Get a pooled service client for background operations
   */
  async getServiceClient(): Promise<SupabaseClient> {
    this.metrics.waitingRequests++

    try {
      // Try to get an idle connection
      let connection = this.servicePool.find(conn => !conn.isActive)
      
      if (!connection) {
        if (this.config.unlimitedMode || this.servicePool.length < this.config.maxConnections) {
          // UNLIMITED: Always create new connection when needed
          connection = await this.createServiceConnection()
          this.servicePool.push(connection)
        } else {
          // Fallback: Wait for available connection (legacy mode)
          connection = await this.waitForAvailableServiceConnection()
        }
      }

      // Mark as active and update metrics
      connection.isActive = true
      connection.lastUsed = Date.now()
      this.updateMetrics()
      
      return connection.client

    } finally {
      this.metrics.waitingRequests--
    }
  }

  /**
   * Release a service client back to the pool
   */
  releaseServiceClient(client: SupabaseClient): void {
    const connection = this.servicePool.find(conn => conn.client === client)
    if (connection) {
      connection.isActive = false
      connection.lastUsed = Date.now()
      this.updateMetrics()
    }
  }

  /**
   * Get pool health metrics
   */
  getMetrics(): PoolMetrics {
    this.updateMetrics()
    return { ...this.metrics }
  }

  getConfigSnapshot(): PoolConfig {
    return { ...this.config }
  }

  /**
   * Health check for monitoring
   */
  async healthCheck(): Promise<{ healthy: boolean; metrics: PoolMetrics; details: string }> {
    const metrics = this.getMetrics()
    const utilizationRate = metrics.activeConnections / this.config.maxConnections
    
    const healthy = this.config.unlimitedMode || (
      metrics.totalConnections <= this.config.maxConnections &&
      metrics.waitingRequests < 10 &&
      utilizationRate < 0.9
    )

    return {
      healthy,
      metrics,
      details: healthy 
        ? `Pool healthy - ${metrics.activeConnections}/${this.config.unlimitedMode ? '∞' : this.config.maxConnections} connections active`
        : `Pool stressed - utilization: ${(utilizationRate * 100).toFixed(1)}%, waiting: ${metrics.waitingRequests}`
    }
  }

  /**
   * Graceful shutdown - cleanup all connections
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Supabase connection pool', { activeConnections: this.metrics.activeConnections })

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }

    // Close all service connections
    for (const connection of this.servicePool) {
      // Supabase clients don't have explicit close methods,
      // but we can clear references
      connection.isActive = false
    }

    this.servicePool = []
    this.sessionPools.clear()

    logger.info('Connection pool shutdown complete')
  }

  // Private methods
  private async initializeServicePool(): Promise<void> {
    for (let i = 0; i < this.config.minConnections; i++) {
      const connection = await this.createServiceConnection()
      this.servicePool.push(connection)
    }
  }

  private async createServiceConnection(): Promise<PooledConnection> {
    const client = createServerClient(
      process.env['NEXT_PUBLIC_SUPABASE_URL']!,
      process.env['SUPABASE_SERVICE_ROLE_KEY']!,
      {
        cookies: {
          get() {
            return null
          },
        },
      }
    )

    this.metrics.connectionsCreated++
    
    return {
      client,
      isActive: false,
      lastUsed: Date.now()
    }
  }

  private async waitForAvailableServiceConnection(): Promise<PooledConnection> {
    return new Promise((resolve, reject) => {
      // UNLIMITED MODE: No timeout constraints
      let timeout: NodeJS.Timeout | null = null
      
      if (this.config.connectionTimeout > 0) {
        timeout = setTimeout(() => {
          reject(new Error('Connection pool timeout'))
        }, this.config.connectionTimeout)
      }

      const checkForConnection = () => {
        const connection = this.servicePool.find(conn => !conn.isActive)
        if (connection) {
          if (timeout) clearTimeout(timeout)
          resolve(connection)
        } else {
          // In unlimited mode, create new connection instead of waiting
          if (this.config.unlimitedMode) {
            this.createServiceConnection().then(newConnection => {
              this.servicePool.push(newConnection)
              if (timeout) clearTimeout(timeout)
              resolve(newConnection)
            }).catch(reject)
          } else {
            setTimeout(checkForConnection, 10)
          }
        }
      }

      checkForConnection()
    })
  }

  private updateMetrics(): void {
    this.metrics.activeConnections = this.servicePool.filter(conn => conn.isActive).length
    this.metrics.idleConnections = this.servicePool.filter(conn => !conn.isActive).length
    this.metrics.totalConnections = this.servicePool.length
  }

  private startCleanupWorker(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections()
    }, 30000) // Run every 30 seconds
  }

  private cleanupIdleConnections(): void {
    const now = Date.now()
    const connectionsToRemove: number[] = []

    this.servicePool.forEach((connection, index) => {
      if (!connection.isActive && 
          now - connection.lastUsed > this.config.idleTimeout &&
          this.servicePool.length > this.config.minConnections) {
        connectionsToRemove.push(index)
      }
    })

    // Remove idle connections (in reverse order to maintain indices)
    connectionsToRemove.reverse().forEach(index => {
      this.servicePool.splice(index, 1)
      this.metrics.connectionsDestroyed++
    })

    if (connectionsToRemove.length > 0) {
      logger.info('Cleaned up idle connections', { connectionsRemoved: connectionsToRemove.length })
    }
  }
}

// Lazy initialization to avoid errors during build
let connectionPoolInstance: SupabaseConnectionPool | null = null

function getConnectionPoolInstance() {
  if (!connectionPoolInstance) {
    connectionPoolInstance = SupabaseConnectionPool.getInstance()
  }
  return connectionPoolInstance
}

export const connectionPool = {
  getServiceClient: async () => getConnectionPoolInstance().getServiceClient(),
  releaseServiceClient: (client: SupabaseClient) => getConnectionPoolInstance().releaseServiceClient(client),
  getMetrics: () => getConnectionPoolInstance().getMetrics(),
  healthCheck: async () => getConnectionPoolInstance().healthCheck(),
  getConfig: () => getConnectionPoolInstance().getConfigSnapshot(),
  shutdown: () => getConnectionPoolInstance().shutdown()
}

// Graceful shutdown handler
if (typeof process !== 'undefined') {
  process.on('SIGTERM', () => getConnectionPoolInstance().shutdown())
  process.on('SIGINT', () => getConnectionPoolInstance().shutdown())
}
