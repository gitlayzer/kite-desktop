/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { Cluster } from '@/types/api'
import { useCurrentClusterList } from '@/lib/api'
import {
  clearCurrentCluster,
  getCurrentCluster,
  setCurrentCluster as persistCurrentCluster,
} from '@/lib/current-cluster'

interface ClusterContextType {
  clusters: Cluster[]
  currentCluster: string | null
  currentClusterData: Cluster | null
  setCurrentCluster: (clusterName: string) => Promise<void>
  enterCluster: (clusterName: string) => Promise<void>
  refreshClusters: () => Promise<void>
  isLoading: boolean
  isSwitching?: boolean
  error: Error | null
}

export const ClusterContext = createContext<ClusterContextType | undefined>(
  undefined
)

export const ClusterProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [currentCluster, setCurrentClusterState] = useState<string | null>(
    getCurrentCluster()
  )
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [isSwitching, setIsSwitching] = useState(false)
  const queryClient = useQueryClient()
  const { refetch: refetchClusters } = useCurrentClusterList({
    enabled: false,
  })

  const refreshClusters = useCallback(async () => {
    const result = await refetchClusters()
    if (result.data) {
      setClusters(result.data)
      setError(null)
      return
    }

    setClusters([])
    setError(result.error instanceof Error ? result.error : null)
  }, [refetchClusters])

  useEffect(() => {
    if (currentCluster) {
      persistCurrentCluster(currentCluster)
      return
    }
    clearCurrentCluster()
  }, [currentCluster])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      setIsLoading(true)
      const result = await refetchClusters()
      if (cancelled) {
        return
      }

      if (result.data) {
        setClusters(result.data)
        setError(null)
      } else {
        setClusters([])
        setError(result.error instanceof Error ? result.error : null)
      }
      setIsLoading(false)
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [refetchClusters])

  useEffect(() => {
    if (isLoading) {
      return
    }

    if (clusters.length === 0) {
      if (currentCluster) {
        setCurrentClusterState(null)
        clearCurrentCluster()
      }
      return
    }

    const selectedCluster = currentCluster
      ? clusters.find((cluster) => cluster.name === currentCluster)
      : null

    if (currentCluster && (!selectedCluster || selectedCluster.error)) {
      setCurrentClusterState(null)
      clearCurrentCluster()
      return
    }
  }, [clusters, currentCluster, isLoading])

  const setCurrentCluster = async (clusterName: string) => {
    if (clusterName === currentCluster || isSwitching) {
      return
    }

    setIsSwitching(true)
    setCurrentClusterState(clusterName)
    persistCurrentCluster(clusterName)

    try {
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0] as string
          return !['user', 'auth', 'clusters'].includes(key)
        },
      })
      toast.success(`Switched to cluster: ${clusterName}`, {
        id: 'cluster-switch',
      })
    } catch (switchError) {
      console.error('Failed to switch cluster:', switchError)
      toast.error('Failed to switch cluster', {
        id: 'cluster-switch',
      })
    } finally {
      setIsSwitching(false)
    }
  }

  const enterCluster = async (clusterName: string) => {
    await setCurrentCluster(clusterName)
  }

  const value: ClusterContextType = {
    clusters,
    currentCluster,
    currentClusterData:
      clusters.find((cluster) => cluster.name === currentCluster) || null,
    setCurrentCluster,
    enterCluster,
    refreshClusters,
    isLoading,
    isSwitching,
    error,
  }

  return (
    <ClusterContext.Provider value={value}>{children}</ClusterContext.Provider>
  )
}
