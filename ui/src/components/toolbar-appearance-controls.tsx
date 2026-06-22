import { useState } from 'react'
import { useAuth } from '@/contexts/auth-context'
import {
  CaseSensitive,
  Check,
  Minus,
  Palette,
  PanelLeftOpen,
  Plus,
  ZoomIn,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useAppearance } from '@/components/appearance-provider'
import { ColorTheme, colorThemes } from '@/components/color-theme-provider'

import { SidebarCustomizer } from './sidebar-customizer'

const DISPLAY_SCALE_MIN = 80
const DISPLAY_SCALE_MAX = 120
const DISPLAY_SCALE_STEP = 5

export function ToolbarAppearanceControls() {
  const { user, hasGlobalSidebarPreference } = useAuth()
  const {
    colorTheme,
    setColorTheme,
    displayScale,
    setDisplayScale,
    font,
    setFont,
  } = useAppearance()
  const [scaleInput, setScaleInput] = useState(String(displayScale))

  const handleDisplayScaleChange = (nextDisplayScale: number) => {
    const clampedDisplayScale = Math.min(
      DISPLAY_SCALE_MAX,
      Math.max(DISPLAY_SCALE_MIN, nextDisplayScale)
    )
    const normalizedDisplayScale =
      Math.round(clampedDisplayScale / DISPLAY_SCALE_STEP) * DISPLAY_SCALE_STEP
    setScaleInput(String(normalizedDisplayScale))
    setDisplayScale(normalizedDisplayScale)
  }

  const commitScaleInput = () => {
    if (scaleInput.trim() === '') {
      setScaleInput(String(displayScale))
      return
    }

    const nextDisplayScale = Number(scaleInput)

    if (!Number.isFinite(nextDisplayScale)) {
      setScaleInput(String(displayScale))
      return
    }

    handleDisplayScaleChange(nextDisplayScale)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Color theme">
            <Palette className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {Object.entries(colorThemes).map(([key]) => {
            const isSelected = key === colorTheme

            return (
              <DropdownMenuItem
                key={key}
                onClick={() => setColorTheme(key as ColorTheme)}
                role="menuitemradio"
                aria-checked={isSelected}
                className={`flex items-center justify-between gap-2 cursor-pointer ${
                  isSelected ? 'font-medium text-foreground' : ''
                }`}
              >
                <span className="capitalize">{key}</span>
                {isSelected && <Check className="h-4 w-4 text-primary" />}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Font">
            <CaseSensitive className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => setFont('system')}
            role="menuitemradio"
            aria-checked={font === 'system'}
            className={`flex items-center justify-between gap-2 cursor-pointer ${
              font === 'system' ? 'font-medium text-foreground' : ''
            }`}
          >
            <span>System</span>
            {font === 'system' && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setFont('maple')}
            role="menuitemradio"
            aria-checked={font === 'maple'}
            className={`flex items-center justify-between gap-2 cursor-pointer ${
              font === 'maple' ? 'font-medium text-foreground' : ''
            }`}
          >
            <span>Maple</span>
            {font === 'maple' && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setFont('jetbrains')}
            role="menuitemradio"
            aria-checked={font === 'jetbrains'}
            className={`flex items-center justify-between gap-2 cursor-pointer ${
              font === 'jetbrains' ? 'font-medium text-foreground' : ''
            }`}
          >
            <span>JetBrains Mono</span>
            {font === 'jetbrains' && (
              <Check className="h-4 w-4 text-primary" />
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Display scale">
            <ZoomIn className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 p-3">
          <div
            className="flex items-center gap-2"
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Button
              aria-label="Decrease display scale"
              className="size-8"
              disabled={displayScale <= DISPLAY_SCALE_MIN}
              size="icon"
              type="button"
              variant="outline"
              onClick={() =>
                handleDisplayScaleChange(displayScale - DISPLAY_SCALE_STEP)
              }
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              aria-label="Display scale percent"
              className="h-8 text-center tabular-nums"
              type="number"
              min={DISPLAY_SCALE_MIN}
              max={DISPLAY_SCALE_MAX}
              step={DISPLAY_SCALE_STEP}
              value={scaleInput}
              onBlur={commitScaleInput}
              onChange={(event) => setScaleInput(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter') {
                  commitScaleInput()
                  event.currentTarget.blur()
                }
              }}
            />
            <Button
              aria-label="Increase display scale"
              className="size-8"
              disabled={displayScale >= DISPLAY_SCALE_MAX}
              size="icon"
              type="button"
              variant="outline"
              onClick={() =>
                handleDisplayScaleChange(displayScale + DISPLAY_SCALE_STEP)
              }
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {user && (user.isAdmin() || !hasGlobalSidebarPreference) ? (
        <SidebarCustomizer
          trigger={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Customize sidebar"
            >
              <PanelLeftOpen className="h-5 w-5" />
            </Button>
          }
        />
      ) : null}
    </>
  )
}
