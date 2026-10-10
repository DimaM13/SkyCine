import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// SPA сама управляет скроллом (useScrollRestore): отключаем штатное
// восстановление браузера по истории — в Safari оно гоняется с нашим
// restore после popstate и сбрасывает позицию в 0.
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
