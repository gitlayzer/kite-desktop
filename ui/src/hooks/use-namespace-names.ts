import { useEffect, useRef, useState } from 'react'

import type { ResourcesTypeMap } from '@/types/api'
import { fetchResources } from '@/lib/api'
import { getCurrentCluster } from '@/lib/current-cluster'
import { useCluster } from '@/hooks/use-cluster'

const NAMESPACE_PAGE_SIZE = 500
const NAMESPACE_NAME_CACHE_LIMIT = 50000

type NamespaceNameSnapshot = {
  names: string[]
  isLoading: boolean
  isComplete: boolean
  limitReached: boolean
  error: string | null
  loadedCount: number
  maxCachedNames: number
}

type NamespaceNameCacheEntry = {
  names: string[]
  isLoading: boolean
  isComplete: boolean
  limitReached: boolean
  error: string | null
  continueToken?: string
  seenNames: Set<string>
  requestId: number
  listeners: Set<(snapshot: NamespaceNameSnapshot) => void>
}

const namespaceNameCache = new Map<string, NamespaceNameCacheEntry>()

function normalizeClusterKey(cluster?: string | null) {
  return cluster || ''
}

function createCacheEntry(): NamespaceNameCacheEntry {
  return {
    names: [],
    isLoading: false,
    isComplete: false,
    limitReached: false,
    error: null,
    seenNames: new Set(),
    requestId: 0,
    listeners: new Set(),
  }
}

function getCacheEntry(clusterKey: string) {
  let entry = namespaceNameCache.get(clusterKey)
  if (!entry) {
    entry = createCacheEntry()
    namespaceNameCache.set(clusterKey, entry)
  }
  return entry
}

function toSnapshot(entry: NamespaceNameCacheEntry): NamespaceNameSnapshot {
  return {
    names: entry.names,
    isLoading: entry.isLoading,
    isComplete: entry.isComplete,
    limitReached: entry.limitReached,
    error: entry.error,
    loadedCount: entry.names.length,
    maxCachedNames: NAMESPACE_NAME_CACHE_LIMIT,
  }
}

function notifyCacheEntry(entry: NamespaceNameCacheEntry) {
  const snapshot = toSnapshot(entry)
  entry.listeners.forEach((listener) => listener(snapshot))
}

function isStillCurrentCluster(clusterKey: string) {
  return normalizeClusterKey(getCurrentCluster()) === clusterKey
}

async function loadNamespaceNames(clusterKey: string) {
  const entry = getCacheEntry(clusterKey)
  if (entry.isLoading || entry.isComplete || entry.limitReached) {
    return
  }

  const requestId = ++entry.requestId
  entry.isLoading = true
  entry.error = null
  notifyCacheEntry(entry)

  try {
    let nextToken = entry.continueToken

    do {
      if (!isStillCurrentCluster(clusterKey)) {
        return
      }

      const page = await fetchResources<ResourcesTypeMap['namespaces']>(
        'namespaces',
        undefined,
        {
          limit: NAMESPACE_PAGE_SIZE,
          continueToken: nextToken,
          reduce: true,
        }
      )

      if (requestId !== entry.requestId || !isStillCurrentCluster(clusterKey)) {
        return
      }

      for (const namespace of page.items || []) {
        const name = namespace.metadata?.name
        if (name && entry.seenNames.size < NAMESPACE_NAME_CACHE_LIMIT) {
          entry.seenNames.add(name)
        }
      }

      entry.names = Array.from(entry.seenNames)

      const previousToken = nextToken
      nextToken = page.metadata?.continue || undefined
      entry.continueToken = nextToken

      if (entry.seenNames.size >= NAMESPACE_NAME_CACHE_LIMIT) {
        entry.limitReached = true
        entry.continueToken = undefined
        nextToken = undefined
      }

      if (nextToken && nextToken === previousToken) {
        entry.continueToken = undefined
        entry.error = 'Namespace 分页游标没有推进，已停止继续加载。'
        nextToken = undefined
      }

      notifyCacheEntry(entry)

      if (nextToken) {
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
    } while (nextToken)

    if (requestId === entry.requestId && !entry.continueToken) {
      entry.isComplete = !entry.limitReached && !entry.error
    }
  } catch (loadError) {
    if (requestId !== entry.requestId) {
      return
    }

    entry.error =
      loadError instanceof Error ? loadError.message : '加载 Namespace 列表失败'
  } finally {
    if (requestId === entry.requestId) {
      entry.isLoading = false
      notifyCacheEntry(entry)
    }
  }
}

export function useNamespaceNames(enabled: boolean) {
  const { currentCluster } = useCluster()
  const clusterKey = normalizeClusterKey(currentCluster)
  const [snapshot, setSnapshot] = useState<NamespaceNameSnapshot>(() =>
    toSnapshot(getCacheEntry(clusterKey))
  )
  const clusterKeyRef = useRef(clusterKey)

  useEffect(() => {
    clusterKeyRef.current = clusterKey
    const entry = getCacheEntry(clusterKey)
    setSnapshot(toSnapshot(entry))

    const listener = (nextSnapshot: NamespaceNameSnapshot) => {
      if (clusterKeyRef.current === clusterKey) {
        setSnapshot(nextSnapshot)
      }
    }

    entry.listeners.add(listener)
    return () => {
      entry.listeners.delete(listener)
    }
  }, [clusterKey])

  useEffect(() => {
    if (enabled) {
      void loadNamespaceNames(clusterKey)
    }
  }, [clusterKey, enabled])

  return snapshot
}
