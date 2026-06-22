import { PackageX, RotateCcw, ShieldX, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  explainError,
  isCRDNotInstalledError,
  isRBACError,
} from '@/lib/utils'

import { Button } from './ui/button'

interface ErrorMessageProps {
  resourceName: string
  error: Error | unknown
  fallbackKey?: string
  className?: string
  refetch: () => void
}

export function ErrorMessage({
  resourceName,
  refetch,
  error,
}: ErrorMessageProps) {
  const { t } = useTranslation()

  if (!error) {
    return null
  }

  const isRBAC = error instanceof Error && isRBACError(error.message)
  const isCRDMissing =
    error instanceof Error && isCRDNotInstalledError(error.message)
  const explanation = explainError(error, t, resourceName)
  const message = explanation.summary

  return (
    <div className="flex min-h-72 flex-col items-center justify-center px-8 py-10 text-center">
      <div className="mb-4">
        {isRBAC ? (
          <ShieldX className="h-16 w-16 text-amber-500" />
        ) : isCRDMissing ? (
          <PackageX className="h-16 w-16 text-muted-foreground" />
        ) : (
          <XCircle className="h-16 w-16 text-red-500" />
        )}
      </div>
      <h3
        className={`text-lg font-medium mb-1 ${isRBAC ? 'text-amber-600' : isCRDMissing ? 'text-muted-foreground' : 'text-red-500'}`}
      >
        {explanation.title}
      </h3>
      <div className="mb-4 max-w-3xl space-y-2 text-sm leading-6">
        <p className="text-foreground">{message}</p>
        {explanation.reason ? (
          <p className="text-muted-foreground">{explanation.reason}</p>
        ) : null}
        {explanation.suggestion ? (
          <p className="text-muted-foreground">{explanation.suggestion}</p>
        ) : null}
      </div>
      <details className="mb-4 w-full max-w-3xl rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-left text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none text-center">
          {t('errors.technicalDetail', '技术详情')}
        </summary>
        <p className="mt-2 whitespace-pre-wrap break-words font-mono leading-5">
          {explanation.technicalDetail}
        </p>
      </details>
      {!isCRDMissing && (
        <Button variant="outline" onClick={() => refetch()}>
          <RotateCcw className="h-4 w-4 mr-2" />
          {t('resourceTable.tryAgain')}
        </Button>
      )}
    </div>
  )
}
