import { FolderSearch } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card'
import { Input } from '../ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select'
import type { SettingsTranslate } from './types'

interface GeneralSettingsTabProps {
  lang: 'zh' | 'en'
  storagePath: string
  t: SettingsTranslate
  onChoosePath: () => void
  onLangChange: (lang: 'zh' | 'en') => void
}

export function GeneralSettingsTab({
  lang,
  storagePath,
  t,
  onChoosePath,
  onLangChange
}: GeneralSettingsTabProps): React.JSX.Element {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-5 pb-3">
          <CardTitle className="text-base">{t('settings.interface')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-5 pt-0">
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t('settings.language')}</label>
            <Select value={lang} onValueChange={(v) => onLangChange(v === 'en' ? 'en' : 'zh')}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder={t('settings.languagePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh">{t('settings.chinese')}</SelectItem>
                <SelectItem value="en">{t('settings.english')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-5 pb-3">
          <CardTitle className="text-base">{t('settings.storage')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-5 pt-0">
          <div>
            <label className="mb-1.5 block text-sm font-medium">{t('settings.storagePath')}</label>
            <div className="flex gap-2">
              <Input
                value={storagePath}
                readOnly
                placeholder={t('settings.storagePlaceholder')}
                className="h-10 min-w-0 flex-1"
              />
              <Button
                variant="secondary"
                onClick={onChoosePath}
                className="h-10 min-w-[96px] shrink-0 rounded-lg border border-[#7ea06f]/45 px-4"
              >
                <FolderSearch className="mr-1.5 h-4 w-4" />
                {t('settings.choose')}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t('settings.storageHint')}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
