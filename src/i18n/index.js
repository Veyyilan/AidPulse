import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './en.js'
import ta from './ta.js'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en, ta },
    fallbackLng: 'en',
    supportedLngs: ['en', 'ta'],
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'aidpulse-lang',
    },
    interpolation: { escapeValue: false },
  })

export default i18n
