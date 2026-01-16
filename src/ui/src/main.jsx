import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { HeroUIProvider } from '@heroui/react';
import { AIContextProvider } from './context/AIContext';
import { ThemeProvider } from './context/ThemeContext';
import { router } from './routes';
import './index.css';

// Initialize i18n (must be imported before App)
import './i18n';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <HeroUIProvider>
        <AIContextProvider>
          <RouterProvider router={router} />
        </AIContextProvider>
      </HeroUIProvider>
    </ThemeProvider>
  </React.StrictMode>
);
