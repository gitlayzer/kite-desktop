import { useCallback, useEffect, useState } from 'react'
import {
  ColumnFiltersState,
  PaginationState,
  RowSelectionState,
  SortingState,
} from '@tanstack/react-table'

import { getClusterScopedStorageKey } from '@/lib/current-cluster'
import { useCluster } from '@/hooks/use-cluster'

const RESOURCE_TABLE_MAX_PAGE_SIZE = 100

interface UseResourceTableStateOptions {
  resourceName: string
  clusterScope: boolean
  defaultHiddenColumns: string[]
}

function readStoredJSON<T>(storage: Storage, key: string, fallback: T): T {
  const value = storage.getItem(key)
  if (!value) {
    return fallback
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function useResourceTableState({
  resourceName,
  clusterScope,
  defaultHiddenColumns,
}: UseResourceTableStateOptions) {
  const { currentClusterData } = useCluster()
  const defaultNamespace = currentClusterData?.defaultNamespace || 'default'
  const requiresNamespace = false
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() =>
    readStoredJSON(
      sessionStorage,
      getClusterScopedStorageKey(`-${resourceName}-columnFilters`),
      []
    )
  )
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    return (
      sessionStorage.getItem(
        getClusterScopedStorageKey(`-${resourceName}-searchQuery`)
      ) || ''
    )
  })
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >(() => {
    const savedVisibility = readStoredJSON<Record<string, boolean> | null>(
      localStorage,
      getClusterScopedStorageKey(`-${resourceName}-columnVisibility`),
      null
    )
    if (savedVisibility) {
      return savedVisibility
    }

    const initialVisibility: Record<string, boolean> = {}
    defaultHiddenColumns.forEach((columnId) => {
      initialVisibility[columnId] = false
    })
    return initialVisibility
  })
  const [pagination, setPagination] = useState<PaginationState>(() => {
    const savedPageSize = sessionStorage.getItem(
      getClusterScopedStorageKey(`-${resourceName}-pageSize`)
    )
    const parsedPageSize = savedPageSize ? Number(savedPageSize) : 20
    const pageSize =
      Number.isFinite(parsedPageSize) && parsedPageSize > 0
        ? Math.min(parsedPageSize, RESOURCE_TABLE_MAX_PAGE_SIZE)
        : 20
    return {
      pageIndex: 0,
      pageSize,
    }
  })
  const [refreshInterval, setRefreshInterval] = useState(30000)
  const [selectedNamespace, setSelectedNamespace] = useState<
    string | undefined
  >(() => {
    const storedNamespace = localStorage.getItem(
      getClusterScopedStorageKey('selectedNamespace')
    )
    if (
      requiresNamespace &&
      (storedNamespace === '_all' || storedNamespace?.includes(','))
    ) {
      return defaultNamespace
    }
    return clusterScope ? undefined : storedNamespace || defaultNamespace
  })
  const [useSSE, setUseSSE] = useState(false)

  const effectiveNamespace = clusterScope
    ? undefined
    : selectedNamespace?.includes(',')
      ? '_all'
      : selectedNamespace

  useEffect(() => {
    if (clusterScope || selectedNamespace !== undefined) {
      return
    }

    const storedNamespace = localStorage.getItem(
      getClusterScopedStorageKey('selectedNamespace')
    )
    setSelectedNamespace(storedNamespace || defaultNamespace)
  }, [clusterScope, defaultNamespace, selectedNamespace])

  useEffect(() => {
    if (clusterScope) {
      return
    }
    const storageKey = getClusterScopedStorageKey('selectedNamespace')
    const storedNamespace = localStorage.getItem(storageKey)
    if (!storedNamespace && selectedNamespace !== defaultNamespace) {
      setSelectedNamespace(defaultNamespace)
    }
  }, [clusterScope, defaultNamespace, selectedNamespace])

  useEffect(() => {
    const storageKey = getClusterScopedStorageKey(
      `-${resourceName}-searchQuery`
    )
    if (searchQuery) {
      sessionStorage.setItem(storageKey, searchQuery)
      return
    }

    sessionStorage.removeItem(storageKey)
  }, [resourceName, searchQuery])

  useEffect(() => {
    localStorage.setItem(
      getClusterScopedStorageKey(`-${resourceName}-columnVisibility`),
      JSON.stringify(columnVisibility)
    )
  }, [columnVisibility, resourceName])

  useEffect(() => {
    sessionStorage.setItem(
      getClusterScopedStorageKey(`-${resourceName}-pageSize`),
      pagination.pageSize.toString()
    )
  }, [pagination.pageSize, resourceName])

  useEffect(() => {
    const storageKey = getClusterScopedStorageKey(
      `-${resourceName}-columnFilters`
    )
    if (columnFilters.length > 0) {
      sessionStorage.setItem(storageKey, JSON.stringify(columnFilters))
      return
    }

    sessionStorage.removeItem(storageKey)
  }, [columnFilters, resourceName])

  useEffect(() => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [columnFilters, searchQuery])

  const handleNamespaceChange = useCallback(
    (value: string) => {
      const safeValue =
        requiresNamespace && (value === '_all' || value.includes(','))
          ? defaultNamespace
          : value
      localStorage.setItem(
        getClusterScopedStorageKey('selectedNamespace'),
        safeValue
      )
      setSelectedNamespace(safeValue)
      setPagination((prev) => ({ ...prev, pageIndex: 0 }))
      setSearchQuery('')
    },
    [defaultNamespace, requiresNamespace]
  )

  const handleUseSSEChange = useCallback((pressed: boolean) => {
    setUseSSE(pressed)
    setRefreshInterval((current) => {
      if (pressed) {
        return 0
      }
      if (current === 0) {
        return 30000
      }
      return current
    })
  }, [])

  const handleRefreshIntervalChange = useCallback((value: number) => {
    setRefreshInterval(value)
    if (value > 0) {
      setUseSSE(false)
    }
  }, [])

  return {
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
    rowSelection,
    setRowSelection,
    deleteDialogOpen,
    setDeleteDialogOpen,
    searchQuery,
    setSearchQuery,
    columnVisibility,
    setColumnVisibility,
    pagination,
    setPagination,
    refreshInterval,
    setRefreshInterval,
    selectedNamespace,
    effectiveNamespace,
    requiresNamespace,
    useSSE,
    handleNamespaceChange,
    handleUseSSEChange,
    handleRefreshIntervalChange,
  }
}
