import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App.js';
import { createIpcClient } from './query/client.js';
import './styles.css';

const client = createIpcClient();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Per-channel intervals live in query/refetch.ts. Nothing is set here, so
      // there is exactly one place to read the application's polling load.
      retry: false,
      refetchOnWindowFocus: true,
      refetchOnReconnect: false,
    },
  },
});

const container = document.getElementById('root');
if (container === null) throw new Error('Renderer root element is missing.');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App client={client} />
    </QueryClientProvider>
  </StrictMode>,
);
