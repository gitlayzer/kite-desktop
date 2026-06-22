import { useMemo } from 'react'

import { ResourceType } from '@/types/api'
import { useResourcesPage, useResourcesWatch } from '@/lib/api'

export const RESOURCE_TABLE_PAGE_SIZE = 100

interface UseResourceTableDataOptions {
  resourceName: string
  resourceType?: ResourceType
  namespace?: string
  useSSE: boolean
  refreshInterval: number
  continueToken?: string
  fieldSelector?: string
  queryParams?: Record<string, string | number | boolean | undefined>
}

export function useResourceTableData<T>({
  resourceName,
  resourceType,
  namespace,
  useSSE,
  refreshInterval,
  continueToken,
  fieldSelector,
  queryParams,
}: UseResourceTableDataOptions) {
  const resolvedResourceType = (resourceType ??
    (resourceName.toLowerCase() as ResourceType)) as ResourceType

  const query = useResourcesPage(resolvedResourceType, namespace, {
    limit: RESOURCE_TABLE_PAGE_SIZE,
    continueToken,
    fieldSelector,
    refreshInterval: useSSE ? 0 : refreshInterval,
    reduce: true,
    queryParams,
    disable: useSSE,
  })

  const watch = useResourcesWatch(resolvedResourceType, namespace, {
    reduce: true,
    fieldSelector,
    queryParams,
    enabled: useSSE,
  })

  const data = useMemo(
    () => (useSSE ? watch.data : query.data?.items) as T[] | undefined,
    [query.data, useSSE, watch.data]
  )

  return {
    resourceType: resolvedResourceType,
    data,
    listMeta: useSSE ? undefined : query.data?.metadata,
    isLoading: useSSE ? watch.isLoading : query.isLoading,
    isError: useSSE ? Boolean(watch.error) : query.isError,
    error: (useSSE ? watch.error : query.error) as Error | null,
    warning: useSSE ? watch.warning : null,
    refetch: useSSE ? watch.refetch : query.refetch,
    isConnected: watch.isConnected,
  }
}
