import { useEffect, useState } from 'react'
import { IconRobot, IconSettings } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  GeneralSettingUpdateRequest,
  updateGeneralSetting,
  useGeneralSetting,
} from '@/lib/api'
import { translateError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5'

interface GeneralSettingsFormData {
  aiAgentEnabled: boolean
  aiProvider: 'openai' | 'anthropic'
  aiModel: string
  aiApiKey: string
  aiApiKeyConfigured: boolean
  aiBaseUrl: string
  aiMaxTokens: number
  enableAnalytics: boolean
  enableVersionCheck: boolean
}

export function GeneralManagement() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data, isLoading } = useGeneralSetting()
  const [formData, setFormData] = useState<GeneralSettingsFormData>({
    aiAgentEnabled: false,
    aiProvider: 'openai',
    aiModel: DEFAULT_MODEL,
    aiApiKey: '',
    aiApiKeyConfigured: false,
    aiBaseUrl: '',
    aiMaxTokens: 4096,
    enableAnalytics: true,
    enableVersionCheck: true,
  })

  useEffect(() => {
    if (!data) return
    setFormData({
      aiAgentEnabled: data.aiAgentEnabled,
      aiProvider: data.aiProvider || 'openai',
      aiModel: data.aiModel || DEFAULT_MODEL,
      aiApiKey: '',
      aiApiKeyConfigured: data.aiApiKeyConfigured ?? false,
      aiBaseUrl: data.aiBaseUrl || '',
      aiMaxTokens: data.aiMaxTokens || 4096,
      enableAnalytics: data.enableAnalytics ?? false,
      enableVersionCheck: data.enableVersionCheck ?? true,
    })
  }, [data])

  const mutation = useMutation({
    mutationFn: (payload: GeneralSettingUpdateRequest) =>
      updateGeneralSetting(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'general-setting' ||
          query.queryKey[0] === 'ai-status' ||
          query.queryKey[0] === 'bootstrap',
      })
      toast.success(
        t('generalManagement.messages.updated', 'General settings updated')
      )
    },
    onError: (error) => {
      toast.error(translateError(error, t))
    },
  })

  const handleSave = () => {
    const defaultModel =
      formData.aiProvider === 'anthropic'
        ? DEFAULT_ANTHROPIC_MODEL
        : DEFAULT_MODEL

    if (formData.aiAgentEnabled && !formData.aiModel.trim()) {
      toast.error(
        t('generalManagement.errors.modelRequired', 'Model is required')
      )
      return
    }
    if (
      formData.aiAgentEnabled &&
      !formData.aiApiKey.trim() &&
      !formData.aiApiKeyConfigured
    ) {
      toast.error(
        t(
          'generalManagement.errors.apiKeyRequired',
          'API Key is required when AI Agent is enabled'
        )
      )
      return
    }
    const payload: GeneralSettingUpdateRequest = {
      aiAgentEnabled: formData.aiAgentEnabled,
      aiProvider: formData.aiProvider,
      aiModel: formData.aiModel.trim() || defaultModel,
      aiBaseUrl: formData.aiBaseUrl.trim(),
      aiMaxTokens: formData.aiMaxTokens || 4096,
      enableAnalytics: formData.enableAnalytics,
      enableVersionCheck: formData.enableVersionCheck,
    }
    if (formData.aiApiKey.trim()) {
      payload.aiApiKey = formData.aiApiKey.trim()
    }

    mutation.mutate(payload)
  }

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">
          {t('common.messages.loading', 'Loading...')}
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconSettings className="h-5 w-5" />
          {t('generalManagement.title', 'General')}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-lg border">
          <div className="flex items-center justify-between p-3">
            <div className="space-y-1">
              <Label className="flex items-center gap-2 text-sm font-medium">
                <IconRobot className="h-4 w-4" />
                {t('generalManagement.aiAgent.title', 'AI Agent')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t(
                  'generalManagement.aiAgent.description',
                  'Enable AI assistant and configure model endpoint.'
                )}
              </p>
            </div>
            <Switch
              checked={formData.aiAgentEnabled}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({ ...prev, aiAgentEnabled: checked }))
              }
            />
          </div>

          {formData.aiAgentEnabled && (
            <div className="space-y-4 border-t p-3">
              <div className="space-y-2">
                <Label htmlFor="general-ai-provider">
                  {t('common.fields.provider', 'Provider')}
                </Label>
                <Select
                  value={formData.aiProvider}
                  onValueChange={(value: 'openai' | 'anthropic') =>
                    setFormData((prev) => ({
                      ...prev,
                      aiProvider: value,
                      aiModel:
                        value === 'anthropic'
                          ? prev.aiModel || DEFAULT_ANTHROPIC_MODEL
                          : prev.aiModel || DEFAULT_MODEL,
                    }))
                  }
                >
                  <SelectTrigger id="general-ai-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI Compatible</SelectItem>
                    <SelectItem value="anthropic">
                      Anthropic Compatible
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="general-ai-model">
                  {t('generalManagement.aiAgent.form.model', 'Model')}
                </Label>
                <Input
                  id="general-ai-model"
                  value={formData.aiModel}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      aiModel: e.target.value,
                    }))
                  }
                  placeholder={
                    formData.aiProvider === 'anthropic'
                      ? DEFAULT_ANTHROPIC_MODEL
                      : DEFAULT_MODEL
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="general-ai-api-key">
                  {t('generalManagement.aiAgent.form.apiKey', 'API Key')}
                </Label>
                <Input
                  id="general-ai-api-key"
                  type="password"
                  value={formData.aiApiKey}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      aiApiKey: e.target.value,
                    }))
                  }
                  placeholder={
                    formData.aiApiKeyConfigured
                      ? t(
                          'generalManagement.aiAgent.form.apiKeyPlaceholder',
                          'Leave empty to keep current API Key'
                        )
                      : 'sk-...'
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="general-ai-base-url">
                  {t('generalManagement.aiAgent.form.baseUrl', 'Base URL')}
                </Label>
                <Input
                  id="general-ai-base-url"
                  value={formData.aiBaseUrl}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      aiBaseUrl: e.target.value,
                    }))
                  }
                  placeholder={
                    formData.aiProvider === 'anthropic'
                      ? 'https://api.anthropic.com'
                      : 'https://api.openai.com/v1'
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="general-ai-max-tokens">
                  {t('generalManagement.aiAgent.form.maxTokens', 'Max Tokens')}
                </Label>
                <Input
                  id="general-ai-max-tokens"
                  type="number"
                  min="1"
                  max="128000"
                  value={formData.aiMaxTokens}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      aiMaxTokens: parseInt(e.target.value) || 4096,
                    }))
                  }
                  placeholder="4096"
                />
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border">
          <div className="p-3">
            <Label className="text-sm font-medium">
              {t('generalManagement.runtime.title', 'Runtime')}
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                'generalManagement.runtime.description',
                'Configure analytics and version checking behavior.'
              )}
            </p>
          </div>

          <div className="flex items-center justify-between border-t p-3">
            <Label htmlFor="general-enable-analytics" className="text-sm">
              {t(
                'generalManagement.runtime.form.enableAnalytics',
                'Enable analytics'
              )}
            </Label>
            <Switch
              id="general-enable-analytics"
              checked={formData.enableAnalytics}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({ ...prev, enableAnalytics: checked }))
              }
            />
          </div>

          <div className="flex items-center justify-between border-t p-3">
            <Label htmlFor="general-enable-version-check" className="text-sm">
              {t(
                'generalManagement.runtime.form.enableVersionCheck',
                'Enable version check'
              )}
            </Label>
            <Switch
              id="general-enable-version-check"
              checked={formData.enableVersionCheck}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({
                  ...prev,
                  enableVersionCheck: checked,
                }))
              }
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={mutation.isPending}>
            {t('common.actions.save', 'Save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
