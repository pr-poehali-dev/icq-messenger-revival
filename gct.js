// get_components_tree.js

import fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';

// Fix для ES модулей (т.к. traverse экспортируется как default)
const traverse = _traverse.default;

// Получение __dirname в ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Базовый путь проекта для создания относительных путей
const projectRoot = process.cwd();

// Функция для преобразования абсолютного пути в относительный
function toRelativePath(absolutePath) {
  if (!absolutePath) return null; // Возвращаем null вместо 'Unknown'
  return path.relative(projectRoot, absolutePath);
}

// Улучшенная функция анализа приложения
function analyzeApp(options) {
  const { entryPoint, includeDependencies = true, depth = 'unlimited' } = options;

  const components = [];
  const routes = [];
  const processedFiles = new Set();
  const importMap = new Map(); // Карта для отслеживания импортов компонентов

  function analyzeFile(filePath, currentDepth = 0) {
    if (processedFiles.has(filePath)) return;
    processedFiles.add(filePath);

    // Проверка глубины анализа
    if (depth !== 'unlimited' && currentDepth > depth) return;

    try {
      if (!fs.existsSync(filePath)) {
        console.log(`Файл не найден: ${filePath}`);
        return;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const ast = parser.parse(content, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript', 'classProperties']
      });

      const fileInfo = {
        name: path.basename(filePath, path.extname(filePath)),
        filePath,
        imports: []
      };

      traverse(ast, {
        ImportDeclaration(pathNode) {
          const importPath = pathNode.node.source.value;
          const importedComponents = pathNode.node.specifiers
            .filter(s => s.type === 'ImportDefaultSpecifier' || s.type === 'ImportSpecifier')
            .map(s => s.local.name);

          fileInfo.imports.push(...importedComponents);

          // Если нужно включить зависимости, анализируем импортированные файлы
          if (includeDependencies) {
            let resolvedPath = importPath;

            // Обработка импортов с алиасами (@/components)
            if (importPath.startsWith('@/')) {
              // Примерное соответствие @/ -> src/
              resolvedPath = importPath.replace('@/', 'src/');
              resolvedPath = path.resolve(process.cwd(), resolvedPath);
            } else if (importPath.startsWith('./') || importPath.startsWith('../')) {
              // Обработка относительных импортов
              const dirName = path.dirname(filePath);
              resolvedPath = path.resolve(dirName, importPath);
            } else {
              // Пропускаем внешние библиотеки
              return;
            }

            // Добавление расширения, если необходимо
            if (!path.extname(resolvedPath)) {
              const extensions = ['.js', '.jsx', '.ts', '.tsx'];
              let fileFound = false;

              for (const ext of extensions) {
                const fullPath = resolvedPath + ext;
                if (fs.existsSync(fullPath)) {
                  resolvedPath = fullPath;
                  fileFound = true;
                  break;
                }
              }

              // Проверка на index файл, если файл не найден напрямую
              if (!fileFound) {
                for (const ext of extensions) {
                  const indexPath = path.join(resolvedPath, `index${ext}`);
                  if (fs.existsSync(indexPath)) {
                    resolvedPath = indexPath;
                    fileFound = true;
                    break;
                  }
                }
              }

              if (!fileFound) {
                // Если файл всё ещё не найден, пробуем последний шанс - директорию модуля
                resolvedPath = path.resolve(process.cwd(), 'node_modules', importPath);
                if (!fs.existsSync(resolvedPath)) {
                  return; // Пропускаем если не найден
                }
              }
            }

            // Сохраняем пути к импортированным компонентам для построения дерева
            importedComponents.forEach(component => {
              importMap.set(component, resolvedPath);
            });

            if (fs.existsSync(resolvedPath)) {
              analyzeFile(resolvedPath, currentDepth + 1);
            }
          }
        },

        JSXElement(pathNode) {
          const openingElement = pathNode.node.openingElement;
          if (openingElement.name.name === 'Route') {
            // Извлекаем атрибуты Route
            let routePath = null;
            let routeElement = null;

            openingElement.attributes.forEach(attr => {
              if (attr.name.name === 'path' && attr.value.type === 'StringLiteral') {
                routePath = attr.value.value;
              } else if (attr.name.name === 'element' && attr.value.type === 'JSXExpressionContainer') {
                if (attr.value.expression.type === 'JSXElement') {
                  routeElement = attr.value.expression.openingElement.name.name;
                }
              }
            });

            if (routePath && routeElement) {
              routes.push({
                path: routePath,
                component: routeElement
              });
            }
          }
        }
      });

      components.push(fileInfo);
    } catch (error) {
      console.error(`Error analyzing file ${filePath}:`, error.message);
    }
  }

  // Начинаем анализ с точки входа
  analyzeFile(entryPoint);

  return { components, routes, importMap };
}

// Улучшенная функция построения иерархии
function buildHierarchy(componentName, graph, visited = new Set()) {
  if (visited.has(componentName)) return null; // Предотвращаем циклические зависимости
  visited.add(componentName);

  const component = graph.components.find(c => c.name === componentName);
  if (!component) {
    // Если компонент не найден в основном списке, попробуем найти его путь в importMap
    const filePath = graph.importMap.get(componentName);
    if (filePath) {
      return {
        name: componentName,
        filePath,
        children: []
      };
    }
    // Если путь не найден, не добавляем свойство filePath
    return { name: componentName, children: [] };
  }

  // Строим дерево дочерних компонентов
  const children = component.imports
    .map(imp => buildHierarchy(imp, graph, new Set([...visited])))
    .filter(Boolean);

  return {
    name: componentName,
    filePath: component.filePath,
    children
  };
}

function getComponentHierarchyForRoute(route, graph) {
  const routeComponent = graph.routes.find(r => r.path === route);
  if (!routeComponent) return null;

  return buildHierarchy(routeComponent.component, graph);
}

// Трансформирует иерархию, заменяя абсолютные пути на относительные
function transformHierarchyPaths(node) {
  if (!node) return null;

  const transformedNode = {
    name: node.name,
  };

  // Добавляем filePath только если он существует
  if (node.filePath) {
    const relativePath = toRelativePath(node.filePath);
    if (relativePath) {
      transformedNode.filePath = relativePath;
    }
  }

  transformedNode.children = (node.children || []).map(transformHierarchyPaths);

  return transformedNode;
}

// Рекурсивное отображение дерева компонентов в консоли
function printComponentTree(node, indent = 0) {
  const spacing = ' '.repeat(indent * 2);
  console.log(`${spacing}${node.name}:`);

  // Выводим путь только если он существует
  if (node.filePath) {
    const relativePath = toRelativePath(node.filePath);
    if (relativePath) {
      console.log(`${spacing}  - Path: ${relativePath}`);
    }
  }

  if (node.children && node.children.length > 0) {
    console.log(`${spacing}  - Children:`);
    node.children.forEach(child => {
      printComponentTree(child, indent + 2);
    });
  } else {
    console.log(`${spacing}  - No children`);
  }
}

// CLI интерфейс
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Использование: node component-graph-analyzer.js [путь-к-маршруту] [путь-к-файлу-точки-входа] [максимальная глубина]');
    process.exit(1);
  }

  const route = args[0];
  const entryPoint = args[1] || './src/App.jsx';
  const depth = args[2] || 'unlimited';


  try {
    const componentGraph = analyzeApp({
      entryPoint,
      includeDependencies: true,
      depth: depth
    });

    const hierarchy = getComponentHierarchyForRoute(route, componentGraph);

    if (hierarchy) {
      // Также сохраняем полное дерево в JSON формате с относительными путями
      const transformedHierarchy = transformHierarchyPaths(hierarchy);
      console.log(JSON.stringify(transformedHierarchy, null, 2));
    } else {
      console.error(`\nМаршрут "${route}" не найден.`);
      process.exit(1);
    }
  } catch (error) {
    console.error("Произошла ошибка при анализе:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

export {
  analyzeApp,
  getComponentHierarchyForRoute,
  buildHierarchy,
  printComponentTree,
  toRelativePath,
  transformHierarchyPaths
};
