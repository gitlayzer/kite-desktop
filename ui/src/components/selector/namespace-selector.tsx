import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useNamespaceNames } from '@/hooks/use-namespace-names'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

const NAMESPACE_RENDER_LIMIT = 100

export function NamespaceSelector({
  selectedNamespace,
  handleNamespaceChange,
  showAll = false,
  disabled = false,
  triggerClassName,
  multiple = false,
  modal = false,
}: {
  selectedNamespace?: string
  handleNamespaceChange: (namespace: string) => void
  showAll?: boolean
  disabled?: boolean
  triggerClassName?: string
  multiple?: boolean
  modal?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [namespaceQuery, setNamespaceQuery] = useState('')
  const {
    names: namespaceNames,
    isLoading,
    isComplete,
    limitReached,
    error,
    loadedCount,
    maxCachedNames,
  } = useNamespaceNames(open)
  const selectedNamespaces = useMemo(() => {
    if (!selectedNamespace || selectedNamespace === '_all') return []
    return selectedNamespace.split(',').filter(Boolean)
  }, [selectedNamespace])

  const filteredNamespaceNames = useMemo(() => {
    const trimmedQuery = namespaceQuery.trim()
    const lowerQuery = trimmedQuery.toLowerCase()
    return lowerQuery
      ? namespaceNames.filter((name) => name.toLowerCase().includes(lowerQuery))
      : namespaceNames
  }, [namespaceNames, namespaceQuery])

  const visibleNamespaceNames = useMemo(() => {
    const trimmedQuery = namespaceQuery.trim()
    const names = filteredNamespaceNames.slice(0, NAMESPACE_RENDER_LIMIT)
    selectedNamespaces.forEach((name) => {
      if (!names.includes(name)) {
        names.push(name)
      }
    })
    if (
      selectedNamespace &&
      selectedNamespace !== '_all' &&
      !selectedNamespace.includes(',') &&
      !names.includes(selectedNamespace)
    ) {
      names.push(selectedNamespace)
    }
    if (trimmedQuery && !names.includes(trimmedQuery)) {
      names.unshift(trimmedQuery)
    }
    return names
  }, [
    filteredNamespaceNames,
    namespaceQuery,
    selectedNamespace,
    selectedNamespaces,
  ])
  const hasHiddenMatches =
    filteredNamespaceNames.length > NAMESPACE_RENDER_LIMIT

  useEffect(() => {
    if (
      isComplete &&
      namespaceNames.length === 1 &&
      selectedNamespace &&
      selectedNamespace !== '_all' &&
      !selectedNamespace.includes(',') &&
      !namespaceNames.includes(selectedNamespace)
    ) {
      handleNamespaceChange(namespaceNames[0])
    }
  }, [handleNamespaceChange, isComplete, namespaceNames, selectedNamespace])

  const triggerLabel =
    selectedNamespace === '_all'
      ? 'All Namespaces'
      : multiple && selectedNamespaces.length > 1
        ? `${selectedNamespaces.length} Namespaces`
        : selectedNamespace || `Select namespace${multiple ? 's' : ''}...`

  const selectNamespace = (namespace: string) => {
    handleNamespaceChange(namespace)
    setOpen(false)
  }

  const toggleNamespace = (namespace: string) => {
    if (selectedNamespace === '_all') {
      handleNamespaceChange(namespace)
      return
    }

    const nextNamespaces = selectedNamespaces.includes(namespace)
      ? selectedNamespaces.filter((name) => name !== namespace)
      : [...selectedNamespaces, namespace]

    handleNamespaceChange(
      nextNamespaces.length > 0 ? nextNamespaces.join(',') : '_all'
    )
  }

  const handleNamespaceSelect = (namespace: string) => {
    if (multiple && selectedNamespaces.length >= 2) {
      toggleNamespace(namespace)
      return
    }

    selectNamespace(namespace)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          setNamespaceQuery('')
        }
      }}
      modal={modal}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full min-w-0 justify-between sm:w-auto sm:min-w-[9rem] sm:max-w-[14rem]',
            triggerClassName
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[max(var(--radix-popover-trigger-width),18rem)] max-w-[min(300px,calc(100vw-1rem))] p-0"
        align="start"
      >
        <Command>
          <CommandInput
            placeholder="输入 Namespace 名称..."
            value={namespaceQuery}
            onValueChange={setNamespaceQuery}
            className="h-9"
          />
          <CommandList className="max-h-[min(50dvh,300px)] overflow-x-hidden overflow-y-auto overscroll-contain">
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {showAll && (
                <CommandItem
                  value="_all"
                  onSelect={() => {
                    handleNamespaceChange('_all')
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4 shrink-0',
                      selectedNamespace === '_all' ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="truncate">All Namespaces</span>
                </CommandItem>
              )}

              {visibleNamespaceNames.map((name) => {
                const selected = multiple
                  ? selectedNamespaces.includes(name)
                  : selectedNamespace === name
                const isTypedNamespace =
                  Boolean(namespaceQuery.trim()) &&
                  name === namespaceQuery.trim() &&
                  !namespaceNames.includes(name)

                return (
                  <CommandItem
                    key={name}
                    value={name}
                    onSelect={() => handleNamespaceSelect(name)}
                    className="flex items-center"
                  >
                    {multiple ? (
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => toggleNamespace(name)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        aria-label={`Toggle namespace ${name}`}
                        className="mr-2"
                      />
                    ) : (
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4 shrink-0',
                          selected ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate" title={name}>
                        {name}
                      </span>
                      {isTypedNamespace ? (
                        <span className="truncate text-xs text-muted-foreground">
                          直接使用输入的 Namespace
                        </span>
                      ) : null}
                    </span>
                  </CommandItem>
                )
              })}
              <div className="space-y-1 px-3 py-2 text-xs text-muted-foreground">
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在索引 Namespace 名称，已加载 {loadedCount} 个
                  </div>
                ) : null}
                {error ? <div>加载 Namespace 失败：{error}</div> : null}
                {limitReached ? (
                  <div>
                    Namespace 数量超过 {maxCachedNames}{' '}
                    个，已停止继续索引以保护内存。
                  </div>
                ) : null}
                {hasHiddenMatches ? (
                  <div>
                    当前匹配 {filteredNamespaceNames.length} 个，仅渲染前{' '}
                    {NAMESPACE_RENDER_LIMIT} 个；继续输入可以缩小结果。
                  </div>
                ) : null}
                {!isLoading && isComplete && namespaceNames.length > 0 ? (
                  <div>已索引全部 {namespaceNames.length} 个 Namespace。</div>
                ) : null}
              </div>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
