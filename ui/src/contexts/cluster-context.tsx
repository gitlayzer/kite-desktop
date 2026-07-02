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
  setCurrentCluster: (clusterName: string) => Promise<boolean>
  enterCluster: (clusterName: string) => Promise<boolean>
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
    if (isSwitching) {
      return false
    }

    const targetCluster = clusters.find(
      (cluster) => cluster.name === clusterName
    )
    if (!targetCluster) {
      toast.error('未找到这个集群，请刷新集群列表后重试。', {
        id: 'cluster-switch',
      })
      return false
    }

    if (targetCluster.enabled === false) {
      toast.error('这个集群已被停用，不能进入工作台。', {
        id: 'cluster-switch',
      })
      return false
    }

    if (targetCluster.error) {
      toast.error(targetCluster.error, {
        id: 'cluster-switch',
      })
      return false
    }

    if (clusterName === currentCluster) {
      return true
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
      toast.success(`已切换到集群：${clusterName}`, {
        id: 'cluster-switch',
      })
      return true
    } catch (switchError) {
      console.error('Failed to switch cluster:', switchError)
      toast.error('切换集群失败，请稍后重试。', {
        id: 'cluster-switch',
      })
      setCurrentClusterState(null)
      clearCurrentCluster()
      return false
    } finally {
      setIsSwitching(false)
    }
  }

  const enterCluster = async (clusterName: string) => {
    return setCurrentCluster(clusterName)
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
