import React from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsApp } from './App';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<SettingsApp />);
