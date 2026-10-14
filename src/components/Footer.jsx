import React from 'react'
import { useTranslation } from 'react-i18next'

export default function Footer() {
  const { t } = useTranslation()
  return (
    <footer className="app-footer">
      {t('footer')}
    </footer>
  )
}
