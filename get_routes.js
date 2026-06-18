// get_routes.js - Simple wrapper to get all routes from the app

import { analyzeApp } from './gct.js';

const args = process.argv.slice(2);

if (args.length < 1) {
  console.error('Usage: node get_routes.js [entry-point]');
  process.exit(1);
}

const entryPoint = args[0];

try {
  const result = analyzeApp({
    entryPoint,
    includeDependencies: false, // Не нужны зависимости, только роуты
    depth: 0 // Только основной файл
  });

  // Возвращаем только роуты в JSON формате
  const routes = result.routes.map(route => ({
    path: route.path,
    component: route.component,
    title: route.component // По умолчанию используем имя компонента как title
  }));

  console.log(JSON.stringify({ routes }, null, 2));
} catch (error) {
  console.error('Error analyzing routes:', error.message);
  process.exit(1);
}
