import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { usePageTitle } from '@/hooks/use-page-title'
import { ResponsiveTabs } from '@/components/ui/responsive-tabs'
import { createSettingsTabsForMode } from '@/components/settings/settings-sections'
import { useAuth } from '@/contexts/auth-context'

export function SettingsPage() {
  const { t } = useTranslation()
  const { capabilities } = useAuth()
  const desktopMode = capabilities.desktopMode
  const tabs = useMemo(
    () => createSettingsTabsForMode(t, desktopMode),
    [desktopMode, t]
  )

  usePageTitle('Settings')

  return (
    <div className="space-y-2">
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl">{t('settings.title', 'Settings')}</h1>
        </div>
        <p className="text-muted-foreground">
          {t('settings.description', 'Manage general configuration and templates')}
        </p>
      </div>

      <ResponsiveTabs tabs={tabs} />
    </div>
  )
}
