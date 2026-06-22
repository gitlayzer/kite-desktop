import { clsx, type ClassValue } from 'clsx'
import { format, formatDistance } from 'date-fns'
import { TFunction } from 'i18next'
import { NodeCondition } from 'kubernetes-types/core/v1'
import { twMerge } from 'tailwind-merge'

import { PodMetrics } from '@/types/api'
import { NodeConditionType } from '@/types/k8s'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Simple debounce function for string input handlers with cancel support
export function debounce(fn: (value: string) => void, delay: number) {
  let timeout: NodeJS.Timeout | null = null

  const debouncedFn = function (value: string) {
    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(() => {
      fn(value)
    }, delay)
  }

  debouncedFn.cancel = function () {
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
  }

  return debouncedFn
}

export function getAge(timestamp: string): string {
  const target = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - target.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const diffHours = Math.floor(
    (diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
  )
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
  const diffSeconds = Math.floor((diffMs % (1000 * 60)) / 1000)

  if (diffDays > 0) {
    return `${diffDays}d`
  } else if (diffHours > 0) {
    return `${diffHours}h`
  } else if (diffMinutes > 0) {
    return `${diffMinutes}m`
  } else {
    return `${diffSeconds}s`
  }
}

export function isVersionAtLeast(version: string | undefined, target: string) {
  const parsed = parseVersion(version)
  const targetParsed = parseVersion(target)
  if (!parsed || !targetParsed) {
    return false
  }
  for (let i = 0; i < 3; i += 1) {
    if (parsed[i] > targetParsed[i]) {
      return true
    }
    if (parsed[i] < targetParsed[i]) {
      return false
    }
  }
  return true
}

function parseVersion(version: string | undefined) {
  if (!version) {
    return null
  }
  const cleaned = version.trim().replace(/^v/, '')
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) {
    return null
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function formatDate(timestamp: string, addTo = false): string {
  const date = new Date(timestamp)
  const s = format(date, 'yyyy-MM-dd HH:mm:ss')
  return addTo ? `${s} (${formatDistance(new Date(), date)})` : s
}

export function formatChartXTicks(
  timestamp: string,
  isSameDay: boolean
): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }
  if (!isSameDay) {
    options.year = 'numeric'
    options.month = '2-digit'
    options.day = '2-digit'
  }
  return new Date(timestamp).toLocaleString(undefined, options)
}

// Format bytes to human readable format
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export function parseBytes(capacity: string): number {
  const units: { [key: string]: number } = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
  }

  const match = capacity.match(/^(\d+)([KMGTP]i)?$/)
  if (match) {
    const value = parseInt(match[1], 10)
    const unit = match[2]
    return unit ? value * units[unit] : value
  }
  return parseInt(capacity, 10)
}

// Format CPU cores
export function formatCPU(cores: string | number): string {
  if (typeof cores === 'string') {
    if (cores.endsWith('m')) {
      const milliCores = parseInt(cores.slice(0, -1))
      return `${(milliCores / 1000).toFixed(3)} cores`
    }
    return `${cores} cores`
  }
  return `${cores} cores`
}

// Format memory
export function formatMemory(memory: string | number): string {
  if (typeof memory === 'number') {
    return formatBytes(memory)
  }

  const units = {
    Ki: 1024,
    Mi: 1024 * 1024,
    Gi: 1024 * 1024 * 1024,
    Ti: 1024 * 1024 * 1024 * 1024,
    K: 1000,
    M: 1000 * 1000,
    G: 1000 * 1000 * 1000,
    T: 1000 * 1000 * 1000 * 1000,
  }

  for (const [suffix, multiplier] of Object.entries(units)) {
    if (memory.endsWith(suffix)) {
      const value = parseFloat(memory.slice(0, -suffix.length))
      return formatBytes(value * multiplier)
    }
  }

  // If no unit, assume bytes
  const numValue = parseFloat(memory)
  if (!isNaN(numValue)) {
    return formatBytes(numValue)
  }

  return memory
}

export function formatPodMetrics(metric: PodMetrics): {
  cpu: number
  memory: number
} {
  let cpu = 0
  let memory = 0
  metric.containers.forEach((container) => {
    const cpuUsage = parseInt(container.usage.cpu, 10) || 0
    if (container.usage.cpu.endsWith('n')) {
      cpu += cpuUsage / 1e9 // nanocores to millicores
    } else if (container.usage.cpu.endsWith('m')) {
      cpu += cpuUsage
    }
    const memoryUsage = parseInt(container.usage.memory, 10) || 0
    if (container.usage.memory.endsWith('Ki')) {
      memory += memoryUsage * 1024
    } else if (container.usage.memory.endsWith('Mi')) {
      memory += memoryUsage * 1024 * 1024
    } else if (container.usage.memory.endsWith('Gi')) {
      memory += memoryUsage * 1024 * 1024 * 1024
    }
  })

  return { cpu, memory }
}
export interface RBACErrorInfo {
  user: string
  verb: string
  resource: string
  namespace?: string
  cluster: string
  apiGroup?: string
  resourceName?: string
}

export function parseRBACError(errorMessage: string): RBACErrorInfo | null {
  const namespacePattern =
    /user (.+) does not have permission to (.+) (.+) in namespace (.+) on cluster (.+)/
  const namespaceMatch = errorMessage.match(namespacePattern)

  if (namespaceMatch) {
    return {
      user: namespaceMatch[1],
      verb: namespaceMatch[2],
      resource: namespaceMatch[3],
      namespace: namespaceMatch[4],
      cluster: namespaceMatch[5],
    }
  }

  const clusterPattern =
    /user (.+) does not have permission to (.+) (.+) on cluster (.+)/
  const clusterMatch = errorMessage.match(clusterPattern)

  if (clusterMatch) {
    return {
      user: clusterMatch[1],
      verb: clusterMatch[2],
      resource: clusterMatch[3],
      cluster: clusterMatch[4],
    }
  }

  const k8sForbiddenPattern =
    /user\s+"([^"]+)"\s+cannot\s+(\w+)\s+resource\s+"([^"]+)"(?:\s+in\s+API\s+group\s+"([^"]*)")?(?:\s+in\s+the\s+namespace\s+"([^"]+)")?(?:\s+at\s+the\s+cluster\s+scope)?/i
  const k8sForbiddenMatch = errorMessage.match(k8sForbiddenPattern)

  if (k8sForbiddenMatch) {
    return {
      user: k8sForbiddenMatch[1],
      verb: k8sForbiddenMatch[2],
      resource: k8sForbiddenMatch[3],
      namespace: k8sForbiddenMatch[5],
      cluster: '',
      apiGroup: k8sForbiddenMatch[4] || undefined,
    }
  }

  return null
}

export function isRBACError(errorMessage: string): boolean {
  return !!parseRBACError(errorMessage)
}

const CRD_NOT_INSTALLED_RE =
  /no matches for kind "([^"]+)" in version "([^"]+)"/

export function isCRDNotInstalledError(errorMessage: string): boolean {
  return CRD_NOT_INSTALLED_RE.test(errorMessage)
}

function getErrorMessage(error: Error | unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export interface PlainErrorExplanation {
  title: string
  summary: string
  reason?: string
  suggestion?: string
  technicalDetail: string
  kind: 'rbac' | 'crd' | 'generic'
}

function getResourceDisplayName(resource: string, t: TFunction): string {
  return t(`nav.${resource}`, {
    defaultValue: t(`common.fields.${resource}`, {
      defaultValue: resource,
    }),
  })
}

export function explainError(
  error: Error | unknown,
  t: TFunction,
  resourceName?: string
): PlainErrorExplanation {
  const technicalDetail = getErrorMessage(error)

  if (!(error instanceof Error)) {
    return {
      title: t('errors.genericTitle', '加载失败'),
      summary: t('common.messages.error', {
        error: technicalDetail,
      }),
      technicalDetail,
      kind: 'generic',
    }
  }

  const crdMatch = CRD_NOT_INSTALLED_RE.exec(error.message)
  if (crdMatch) {
    return {
      title: t('errors.crdNotInstalledTitle'),
      summary: t('errors.crdNotInstalledSummary', {
        kind: crdMatch[1],
        version: crdMatch[2],
      }),
      reason: t('errors.crdNotInstalledReason', {
        kind: crdMatch[1],
      }),
      suggestion: t('errors.crdNotInstalledSuggestion'),
      technicalDetail,
      kind: 'crd',
    }
  }

  const rbacInfo = parseRBACError(error.message)
  if (rbacInfo) {
    const verb = t(`rbac.verb.${rbacInfo.verb}`, {
      defaultValue: rbacInfo.verb,
    })
    const resource = getResourceDisplayName(rbacInfo.resource, t)
    const scope = rbacInfo.namespace
      ? t('errors.rbac.scopeNamespace', {
          namespace: rbacInfo.namespace,
        })
      : t('errors.rbac.scopeCluster')

    return {
      title: t('errors.rbac.title', '权限不够，加载失败'),
      summary: t('errors.rbac.summary', {
        resource: resourceName || resource,
        verb,
        scope,
      }),
      reason: t('errors.rbac.reason', {
        user: rbacInfo.user,
        verb,
        resource,
        scope,
      }),
      suggestion: t('errors.rbac.suggestion'),
      technicalDetail,
      kind: 'rbac',
    }
  }

  return {
    title: t('errors.genericTitle', '加载失败'),
    summary: t('errors.genericSummary', {
      resource:
        resourceName ||
        t('common.fields.resource', {
          defaultValue: '资源',
        }),
    }),
    suggestion: t('errors.genericSuggestion'),
    technicalDetail,
    kind: 'generic',
  }
}

export function translateError(error: Error | unknown, t: TFunction): string {
  return explainError(error, t).summary
}

/**
 * Enrich Node Conditions with computed health status
 *
 * Adds an `health` field with normalized semantics:
 * - `True` = healthy state
 * - `False` = unhealthy state
 */
export function enrichNodeConditionsWithHealth(data: NodeCondition[]) {
  return data.map((item) => {
    const shouldReverseStatus = (
      [
        'DiskPressure',
        'MemoryPressure',
        'PIDPressure',
        'NetworkUnavailable',
      ] as NodeConditionType[]
    ).includes(item.type as NodeConditionType)

    return {
      ...item,
      health: shouldReverseStatus
        ? item.status === 'True'
          ? 'False'
          : item.status === 'False'
            ? 'True'
            : item.status
        : item.status,
    }
  })
}
