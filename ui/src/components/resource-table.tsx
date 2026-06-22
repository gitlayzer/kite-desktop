import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ColumnDef,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { Box, Database } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ResourceType } from '@/types/api'
import { deleteResource } from '@/lib/api'
import { getResourceMetadata } from '@/lib/resource-catalog'
import { useCluster } from '@/hooks/use-cluster'
import {
  RESOURCE_TABLE_PAGE_SIZE,
  useResourceTableData,
} from '@/hooks/use-resource-table-data'
import { useResourceTableState } from '@/hooks/use-resource-table-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { ErrorMessage } from './error-message'
import { ResourceTableToolbar } from './resource-table-toolbar'
import { ResourceTableView } from './resource-table-view'

export interface ResourceTableProps<T> {
  resourceName: string
  resourceType?: ResourceType // Optional, used for fetching resources
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[]
  clusterScope?: boolean // If true, don't show namespace selector
  searchQueryFilter?: (item: T, query: string) => boolean // Custom filter function
  showCreateButton?: boolean // If true, show create button
  onCreateClick?: () => void // Callback for create button click
  extraToolbars?: React.ReactNode[] // Additional toolbar components
  defaultHiddenColumns?: string[] // Columns to hide by default
  resourceQueryParams?: Record<string, string | number | boolean | undefined>
}

export function ResourceTable<T>(props: ResourceTableProps<T>) {
  const { currentCluster } = useCluster()
  return React.createElement(ResourceTableContent<T>, {
    ...props,
    key: currentCluster || '',
  })
}

function ResourceTableContent<T>({
  resourceName,
  resourceType,
  columns,
  clusterScope = false,
  searchQueryFilter,
  showCreateButton = false,
  onCreateClick,
  extraToolbars = [],
  defaultHiddenColumns = [],
  resourceQueryParams,
}: ResourceTableProps<T>) {
  const { t } = useTranslation()
  const {
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
  } = useResourceTableState({
    resourceName,
    clusterScope,
    defaultHiddenColumns,
  })
  const selectedNamespaces = useMemo(() => {
    if (!selectedNamespace || selectedNamespace === '_all') return []
    return selectedNamespace.split(',').filter(Boolean)
  }, [selectedNamespace])
  const namespaceDescription =
    selectedNamespace === '_all'
      ? 'All Namespaces'
      : selectedNamespaces.length > 1
        ? `${selectedNamespaces.length} namespaces`
        : selectedNamespace
          ? `namespace ${selectedNamespace}`
          : ''
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteProgress, setDeleteProgress] = useState({ done: 0, total: 0 })
  const [cursorIndex, setCursorIndex] = useState(0)
  const [pageTokens, setPageTokens] = useState<string[]>([''])
  const [serverNameFilter, setServerNameFilter] = useState('')
  const currentContinueToken = pageTokens[cursorIndex] || undefined
  const fieldSelector = serverNameFilter
    ? `metadata.name=${serverNameFilter}`
    : undefined
  const {
    resourceType: resolvedResourceType,
    data,
    listMeta,
    isLoading,
    isError,
    error,
    warning,
    refetch,
    isConnected,
  } = useResourceTableData<T>({
    resourceName,
    resourceType,
    namespace: effectiveNamespace,
    useSSE,
    refreshInterval,
    continueToken: currentContinueToken,
    fieldSelector,
    queryParams: resourceQueryParams,
  })
  const displayResourceName = (() => {
    const resource = getResourceMetadata(resolvedResourceType)
    if (!resource) {
      return resourceName
    }
    if (resource.titleKey) {
      return t(resource.titleKey, {
        defaultValue:
          resource.shortLabel || resource.pluralLabel || resourceName,
      })
    }
    return resource.shortLabel || resource.pluralLabel || resourceName
  })()

  // Add namespace column when showing all namespaces
  const enhancedColumns = useMemo(() => {
    const selectColumn: ColumnDef<T> = {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    }

    const baseColumns = [selectColumn, ...columns]

    // Only add namespace column if not cluster scope, showing all namespaces,
    // and there isn't already a namespace column in the provided columns
    if (
      !clusterScope &&
      (selectedNamespace === '_all' || selectedNamespaces.length > 1)
    ) {
      // Check if namespace column already exists in the provided columns
      const hasNamespaceColumn = columns.some((col) => {
        // Check if the column accesses namespace data
        if ('accessorKey' in col && col.accessorKey === 'metadata.namespace') {
          return true
        }
        if ('accessorFn' in col && col.id === 'namespace') {
          return true
        }
        return false
      })

      // Only add namespace column if it doesn't already exist
      if (!hasNamespaceColumn) {
        const namespaceColumn = {
          id: 'namespace',
          header: t('resourceTable.namespace'),
          accessorFn: (row: T) => {
            // Try to get namespace from metadata.namespace
            const metadata = (row as { metadata?: { namespace?: string } })
              ?.metadata
            return metadata?.namespace || '-'
          },
          cell: ({ getValue }: { getValue: () => string }) => (
            <Badge variant="outline" className="ml-2 ">
              {getValue()}
            </Badge>
          ),
        }

        // Insert namespace column after select and first column (typically name)
        const columnsWithNamespace = [...baseColumns]
        columnsWithNamespace.splice(2, 0, namespaceColumn)
        return columnsWithNamespace
      }
    }
    return baseColumns
  }, [columns, clusterScope, selectedNamespace, selectedNamespaces.length, t])

  const namespaceFilteredData = useMemo(() => {
    if (clusterScope || selectedNamespaces.length <= 1) {
      return data
    }

    return (data as T[] | undefined)?.filter((item) => {
      const namespace = (item as { metadata?: { namespace?: string } })
        ?.metadata?.namespace
      return namespace ? selectedNamespaces.includes(namespace) : false
    })
  }, [clusterScope, data, selectedNamespaces])

  const memoizedData = useMemo(
    () => (namespaceFilteredData || []) as T[],
    [namespaceFilteredData]
  )
  const hasNextCursor = Boolean(listMeta?.continue)
  const hasPreviousCursor = cursorIndex > 0
  const isAllNamespacesView = !clusterScope && selectedNamespace === '_all'
  const resetCursor = useCallback(() => {
    setCursorIndex(0)
    setPageTokens([''])
  }, [])

  useEffect(() => {
    resetCursor()
  }, [
    resolvedResourceType,
    effectiveNamespace,
    serverNameFilter,
    searchQuery,
    columnFilters,
    resetCursor,
  ])

  const applyExactNameFilter = useCallback(() => {
    const trimmed = searchQuery.trim()
    setServerNameFilter(trimmed)
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    resetCursor()
  }, [resetCursor, searchQuery, setPagination])

  const clearExactNameFilter = useCallback(() => {
    setServerNameFilter('')
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
    resetCursor()
  }, [resetCursor, setPagination])

  const handleNextDataPage = useCallback(() => {
    const nextToken = listMeta?.continue
    if (!nextToken) {
      return
    }
    setPageTokens((current) => {
      if (current[cursorIndex + 1] === nextToken) {
        return current
      }
      const next = current.slice(0, cursorIndex + 1)
      next.push(nextToken)
      return next
    })
    setCursorIndex((current) => current + 1)
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [cursorIndex, listMeta?.continue, setPagination])

  const handlePreviousDataPage = useCallback(() => {
    if (cursorIndex === 0) {
      return
    }
    setCursorIndex((current) => Math.max(0, current - 1))
    setPagination((prev) => ({
      ...prev,
      pageIndex: Math.max(
        0,
        Math.ceil(RESOURCE_TABLE_PAGE_SIZE / prev.pageSize) - 1
      ),
    }))
  }, [cursorIndex, setPagination])
  const handleSafeUseSSEChange = useCallback(
    (pressed: boolean) => {
      if (
        pressed &&
        resolvedResourceType === 'pods' &&
        (!effectiveNamespace || effectiveNamespace === '_all')
      ) {
        toast.error('为了避免大集群卡顿，请先选择一个命名空间后再开启 Watch。')
        return
      }
      handleUseSSEChange(pressed)
    },
    [effectiveNamespace, handleUseSSEChange, resolvedResourceType]
  )

  useEffect(() => {
    if (!useSSE && error) {
      setRefreshInterval(0)
    }
  }, [useSSE, error, setRefreshInterval])

  // Create table instance using TanStack Table
  const table = useReactTable<T>({
    data: memoizedData,
    columns: enhancedColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getRowId: (row) => {
      const metadata = (
        row as {
          metadata?: { name?: string; namespace?: string; uid?: string }
        }
      )?.metadata
      if (!metadata?.name) {
        return `row-${Math.random()}`
      }
      return (
        metadata.uid ||
        (metadata.namespace
          ? `${metadata.namespace}/${metadata.name}`
          : metadata.name)
      )
    },
    state: {
      sorting,
      columnFilters,
      globalFilter: searchQuery,
      pagination,
      rowSelection,
      columnVisibility,
    },
    onPaginationChange: setPagination,
    // Let TanStack Table handle pagination automatically based on filtered data
    manualPagination: false,
    // Improve filtering performance and consistency
    globalFilterFn: (row, _columnId, value) => {
      if (searchQueryFilter) {
        return searchQueryFilter(row.original as T, String(value).toLowerCase())
      }
      const searchValue = String(value).toLowerCase()

      // Search across all visible columns
      return row.getVisibleCells().some((cell) => {
        const cellValue = String(cell.getValue() || '').toLowerCase()
        return cellValue.includes(searchValue)
      })
    },
    // Add this to prevent unnecessary pagination resets
    autoResetPageIndex: false,
    enableRowSelection: true,
  })

  // Handle batch delete - must be after table is defined
  const handleBatchDelete = useCallback(async () => {
    setIsDeleting(true)
    const selectedRows = table
      .getSelectedRowModel()
      .rows.map((row) => row.original)

    const total = selectedRows.length
    setDeleteProgress({ done: 0, total })

    const deletePromises = selectedRows.map((row) => {
      const metadata = (
        row as { metadata?: { name?: string; namespace?: string } }
      )?.metadata
      const name = metadata?.name
      const namespace = clusterScope ? undefined : metadata?.namespace

      if (!name) {
        setDeleteProgress((prev) => ({ ...prev, done: prev.done + 1 }))
        return Promise.resolve()
      }

      return deleteResource(resolvedResourceType, name, namespace)
        .then(() => {
          setDeleteProgress((prev) => ({ ...prev, done: prev.done + 1 }))
          toast.success(t('resourceTable.deleteSuccess', { name }))
        })
        .catch((error) => {
          setDeleteProgress((prev) => ({ ...prev, done: prev.done + 1 }))
          console.error(`Failed to delete ${name}:`, error)
          toast.error(
            t('resourceTable.deleteFailed', { name, error: error.message })
          )
          throw error
        })
    })

    try {
      await Promise.allSettled(deletePromises)
      // Reset selection and close dialog
      setRowSelection({})
      setDeleteDialogOpen(false)
      // Refetch data
      if (!useSSE) {
        refetch()
      }
    } finally {
      setIsDeleting(false)
    }
  }, [
    table,
    clusterScope,
    resolvedResourceType,
    t,
    useSSE,
    refetch,
    setRowSelection,
    setDeleteDialogOpen,
  ])
  // Calculate total and filtered row counts
  const totalRowCount = useMemo(
    () => (namespaceFilteredData as T[] | undefined)?.length || 0,
    [namespaceFilteredData]
  )
  const filteredRowCount = useMemo(() => {
    if (!namespaceFilteredData || (namespaceFilteredData as T[]).length === 0)
      return 0
    // Force re-computation when filters change
    void searchQuery // Ensure dependency is used
    void columnFilters // Ensure dependency is used
    return table.getFilteredRowModel().rows.length
  }, [table, namespaceFilteredData, searchQuery, columnFilters])

  // Check if there are active filters
  const hasActiveFilters = useMemo(() => {
    return Boolean(searchQuery) || columnFilters.length > 0
  }, [searchQuery, columnFilters])

  // Render empty state based on condition
  const renderEmptyState = () => {
    // Only show loading state if there's no existing data
    if (
      isLoading &&
      (!namespaceFilteredData || (namespaceFilteredData as T[]).length === 0)
    ) {
      return (
        <div className="h-72 flex flex-col items-center justify-center">
          <div className="mb-4 bg-muted/30 p-6 rounded-full">
            <Database className="h-12 w-12 text-muted-foreground animate-pulse" />
          </div>
          <h3 className="text-lg font-medium mb-1">
            Loading {displayResourceName}...
          </h3>
          <p className="text-muted-foreground">
            Retrieving data
            {!clusterScope && namespaceDescription
              ? ` from ${namespaceDescription}`
              : ''}
          </p>
        </div>
      )
    }

    if (isError) {
      return (
        <ErrorMessage
          resourceName={displayResourceName}
          error={error}
          refetch={refetch}
        />
      )
    }

    if (namespaceFilteredData && (namespaceFilteredData as T[]).length === 0) {
      return (
        <div className="h-72 flex flex-col items-center justify-center">
          <div className="mb-4 bg-muted/30 p-6 rounded-full">
            <Box className="h-12 w-12 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium mb-1">
            No {displayResourceName} found
          </h3>
          <p className="text-muted-foreground">
            {searchQuery
              ? `No results match your search query: "${searchQuery}"`
              : clusterScope
                ? `There are no ${displayResourceName} found`
                : `There are no ${displayResourceName} in ${namespaceDescription}`}
          </p>
          {searchQuery && (
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setSearchQuery('')}
            >
              Clear Search
            </Button>
          )}
        </div>
      )
    }

    return null
  }

  const emptyState = renderEmptyState()

  return (
    <div className="flex flex-col gap-3">
      {!useSSE &&
        (hasNextCursor || hasPreviousCursor || isAllNamespacesView) && (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {isAllNamespacesView
              ? `All Namespaces 会按游标分批读取 ${RESOURCE_TABLE_PAGE_SIZE} 条资源；每次只保留当前批次，避免大集群占满内存。搜索框默认搜索当前页，按 Enter 会按精确资源名向集群查询。`
              : '为了保证大集群下应用不卡顿，当前只加载一批资源。可使用分页按钮继续加载下一批；输入框默认搜索当前页，按 Enter 会按精确资源名向集群查询。'}
          </div>
        )}
      {serverNameFilter ? (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          已启用精确名称查询：{serverNameFilter}。清空搜索可回到分页浏览。
        </div>
      ) : null}
      {warning ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {warning}
        </div>
      ) : null}
      <ResourceTableToolbar
        table={table}
        resourceName={displayResourceName}
        resourceType={resolvedResourceType}
        clusterScope={clusterScope}
        extraToolbars={extraToolbars}
        showCreateButton={showCreateButton}
        onCreateClick={onCreateClick}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        serverNameFilter={serverNameFilter}
        onApplyExactNameFilter={applyExactNameFilter}
        onClearExactNameFilter={clearExactNameFilter}
        selectedNamespace={selectedNamespace}
        handleNamespaceChange={handleNamespaceChange}
        requiresNamespace={requiresNamespace}
        useSSE={useSSE}
        isConnected={isConnected}
        refreshInterval={refreshInterval}
        onUseSSEChange={handleSafeUseSSEChange}
        onRefreshIntervalChange={handleRefreshIntervalChange}
        selectedRowCount={table.getSelectedRowModel().rows.length}
        onOpenDeleteDialog={() => setDeleteDialogOpen(true)}
      />

      <ResourceTableView
        table={table}
        columnCount={enhancedColumns.length}
        isLoading={isLoading}
        data={namespaceFilteredData as T[] | undefined}
        fitViewportHeight={true}
        emptyState={emptyState}
        hasActiveFilters={hasActiveFilters}
        filteredRowCount={filteredRowCount}
        totalRowCount={totalRowCount}
        searchQuery={searchQuery}
        pagination={pagination}
        setPagination={setPagination}
        showAllPageSize={false}
        hasNextPage={hasNextCursor}
        onNextPage={handleNextDataPage}
        onPreviousPage={hasPreviousCursor ? handlePreviousDataPage : undefined}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('resourceTable.confirmDeletion')}</DialogTitle>
            <DialogDescription>
              {t('resourceTable.confirmDeletionMessage', {
                count: table.getSelectedRowModel().rows.length,
                resourceName: displayResourceName,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              {t('common.actions.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleBatchDelete}
              disabled={isDeleting}
            >
              {isDeleting
                ? t('resourceTable.deletingProgress', {
                    done: deleteProgress.done,
                    total: deleteProgress.total,
                  })
                : t('common.actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
