import '@fontsource-variable/urbanist';
import './styles/main.css';
import { HeroSection } from './hero/HeroSection';

const heroEl = document.querySelector<HTMLElement>('[data-hero]');
if (heroEl) {
  const hero = new HeroSection(heroEl);
  hero.init();
  if (import.meta.hot) import.meta.hot.dispose(() => hero.dispose());
}

// Footer year.
const year = document.querySelector('[data-year]');
if (year) year.textContent = String(new Date().getFullYear());
