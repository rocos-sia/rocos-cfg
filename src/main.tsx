import { createRoot } from 'react-dom/client';
import Application from './App';
import 'antd/dist/reset.css';
import './styles/configurator.css';
createRoot(document.getElementById('root')!).render(<Application/>);
