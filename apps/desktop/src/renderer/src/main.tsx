import { createRoot } from 'react-dom/client';
import { App } from '@fib/panel/src/App';

const container = document.getElementById('app');
if (container) {
  createRoot(container).render(<App />);
}
