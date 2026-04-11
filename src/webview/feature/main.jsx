import React from 'react';
import { createRoot } from 'react-dom/client';
import { FeatureApp } from './App';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<FeatureApp />);
