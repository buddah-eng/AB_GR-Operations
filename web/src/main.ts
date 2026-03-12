import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'
import { plugin as formkitPlugin, defaultConfig } from '@formkit/vue'

import 'primeicons/primeicons.css'
import './styles/global.css'
import './firebase'

import App from './App.vue'
import router from './router'

const app = createApp(App)

/* ---- Pinia ---- */
const pinia = createPinia()
app.use(pinia)

/* ---- Vue Router ---- */
app.use(router)

/* ---- PrimeVue ---- */
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      prefix: 'p',
      darkModeSelector: '.dark-mode',
      cssLayer: false,
    },
  },
})
app.use(ToastService)
app.use(ConfirmationService)

/* ---- FormKit ---- */
app.use(formkitPlugin, defaultConfig)

/* ---- Mount ---- */
app.mount('#app')
