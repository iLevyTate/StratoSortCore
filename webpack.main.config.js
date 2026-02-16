const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');

const commonConfig = (isProduction) => ({
  mode: isProduction ? 'production' : 'development',
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [['@babel/preset-env', { targets: { node: 'current' } }]]
          }
        }
      }
    ]
  },
  resolve: {
    extensions: ['.js', '.json']
  },
  optimization: {
    minimize: isProduction,
    minimizer: [
      new TerserPlugin({
        parallel: true,
        extractComments: false,
        terserOptions: {
          compress: {
            pure_funcs: ['console.log', 'console.debug']
          }
        }
      })
    ]
  },
  devtool: isProduction ? false : 'source-map'
});

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  const common = commonConfig(isProduction);

  const mainConfig = {
    ...common,
    entry: {
      main: './src/main/simple-main.js',
      ocrWorker: './src/main/workers/ocrWorker.js',
      embeddingWorker: './src/main/workers/embeddingWorker.js'
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      libraryTarget: 'commonjs2',
      clean: false
    },
    target: 'electron-main',
    node: {
      __dirname: false,
      __filename: false
    },
    externals: [
      {
        electron: 'commonjs electron',
        sharp: 'commonjs sharp',
        '@napi-rs/canvas': 'commonjs @napi-rs/canvas',
        'electron-updater': 'commonjs electron-updater',
        'better-sqlite3': 'commonjs better-sqlite3',
        'lz4-napi': 'commonjs lz4-napi',
        'tesseract.js': 'commonjs tesseract.js',
        'tesseract.js-core': 'commonjs tesseract.js-core',
        // Pino uses thread-stream which spawns Worker threads via __dirname-relative
        // paths. Bundling breaks __dirname resolution, so keep pino ecosystem external.
        pino: 'commonjs pino',
        'pino-pretty': 'commonjs pino-pretty',
        // Piscina spawns its internal bootstrap worker via resolve(__dirname, 'worker.js').
        // Bundling moves __dirname to dist/ where piscina's worker.js doesn't exist.
        piscina: 'commonjs piscina',
        // unpdf bundles pdf.js which contains dynamic import() expressions that
        // webpack cannot statically analyze. Runs fine as a runtime require in
        // the Node.js main process.
        unpdf: 'commonjs unpdf'
      },
      ({ request }, callback) => {
        if (!request) return callback();

        if (
          request === 'node-llama-cpp' ||
          request.startsWith('@node-llama-cpp/') ||
          request === '@reflink/reflink' ||
          request.startsWith('@reflink/')
        ) {
          return callback(null, `commonjs ${request}`);
        }

        // @sentry/electron imports @sentry/node which re-exports tracing
        // integrations (postgresjs, prisma) that pull in @opentelemetry and
        // require-in-the-middle. These use runtime require() hooks that
        // webpack cannot statically analyze. Keep the entire Sentry tree
        // external since it runs correctly as runtime-resolved CommonJS.
        if (request === '@sentry/electron' || request.startsWith('@sentry/electron/')) {
          return callback(null, `commonjs ${request}`);
        }

        if (request.endsWith('.node')) {
          return callback(null, `commonjs ${request}`);
        }

        return callback();
      }
    ],
    plugins: [
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development')
      })
    ]
  };

  const preloadConfig = {
    ...common,
    entry: {
      preload: './src/preload/preload.js'
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: false
    },
    // Keep preload bundled for sandbox=true while preserving Electron preload semantics.
    target: 'electron-preload',
    resolve: {
      ...common.resolve,
      alias: {
        ...common.resolve?.alias,
        'node:os': require.resolve('os-browserify/browser'),
        'node:path': require.resolve('path-browserify'),
        'node:process': require.resolve('process/browser')
      },
      fallback: {
        ...common.resolve?.fallback,
        path: require.resolve('path-browserify'),
        fs: false, // Ensure fs is disabled
        os: require.resolve('os-browserify/browser'),
        process: require.resolve('process/browser')
      }
    },
    externals: {
      electron: 'commonjs electron',
      // Preload doesn't have access to these native modules anyway
      sharp: 'commonjs sharp'
    },
    plugins: [
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development')
      }),
      new webpack.ProvidePlugin({
        process: 'process/browser'
      }),
      // FIX: Ignore Node.js specific modules in preload build to suppress warnings
      // correlationId.js handles missing modules gracefully
      new webpack.IgnorePlugin({
        resourceRegExp: /^(async_hooks|crypto)$/
      })
    ]
  };

  return [mainConfig, preloadConfig];
};
