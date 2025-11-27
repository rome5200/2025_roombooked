import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// 🔹 root DOM이 있을 때만 React를 마운트
const container = document.getElementById('root');

if (container) {
  const root = ReactDOM.createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  // root 없으면 그냥 경고만 찍고, 우리 순수 HTML/app.js만 동작하도록 둔다
  console.warn('index.js: id="root" 요소를 찾지 못해서 React를 마운트하지 않았습니다.');
}