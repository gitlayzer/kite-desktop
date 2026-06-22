import { IconCheck, IconChevronDown, IconServer } from '@tabler/icons-react'

import { cn } from '@/lib/utils'
import { useCluster } from '@/hooks/use-cluster'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function InlineClusterSelector({
  triggerClassName,
}: {
  triggerClassName?: string
}) {
  const {
    clusters = [],
    currentCluster,
    setCurrentCluster = async () => {},
    isSwitching,
    isLoading,
  } = useCluster()

  const currentClusterData = clusters.find((c) => c.name === currentCluster)
  const label = isSwitching
    ? '切换中...'
    : currentClusterData?.name || '选择集群'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn(
            'w-full min-w-0 justify-between gap-2 sm:w-auto sm:min-w-[9rem] sm:max-w-[14rem]',
            triggerClassName
          )}
          disabled={isLoading || isSwitching}
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <IconServer className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </span>
          <IconChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {clusters.map((cluster) => (
          <DropdownMenuItem
            key={cluster.name}
            onClick={() => void setCurrentCluster(cluster.name)}
            className="flex items-center justify-between gap-3"
          >
            <div className="flex min-w-0 flex-col">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{cluster.name}</span>
                {cluster.isDefault ? (
                  <Badge variant="secondary" className="text-xs">
                    默认
                  </Badge>
                ) : null}
                {cluster.error ? (
                  <Badge variant="destructive" className="text-xs">
                    同步错误
                  </Badge>
                ) : null}
              </div>
              <span
                className={cn(
                  'truncate text-xs',
                  cluster.error
                    ? 'text-destructive'
                    : 'font-mono text-muted-foreground'
                )}
                title={cluster.error}
              >
                {cluster.error || cluster.version || '-'}
              </span>
            </div>
            {currentCluster === cluster.name ? (
              <IconCheck className="h-4 w-4 shrink-0" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
