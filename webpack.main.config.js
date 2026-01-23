const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');

const commonConfig = (isProduction) => ({
  mode: isProduction ? 'production' : 'development',
  module: {
    rules: [
      {
        test: /\.(js|ts)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { targets: { node: 'current' } }],
              '@babel/preset-typescript'
            ]
          }
        }
      }
    ]
  },
  resolve: {
    extensions: ['.js', '.ts', '.json']
  },
  optimization: {
    minimize: isProduction,
    minimizer: [
      new TerserPlugin({
        parallel: true,
        extractComments: false,
        terserOptions: {
          compress: {
            drop_console: isProduction
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
      main: './src/main/simple-main.js'
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: false
    },
    target: 'electron-main',
    externals: {
      electron: 'commonjs electron',
      sharp: 'commonjs sharp',
      'node-tesseract-ocr': 'commonjs node-tesseract-ocr',
      chromadb: 'commonjs chromadb',
      'electron-updater': 'commonjs electron-updater',
      'pdf-parse': 'commonjs pdf-parse'
    },
    ignoreWarnings: [
      (warning) =>
        /Critical dependency: the request of a dependency is an expression/.test(
          warning?.message || ''
        ) &&
        /[\\/]node_modules[\\/]pdf-parse[\\/]dist[\\/]pdf-parse[\\/]cjs[\\/]index\.cjs$/.test(
          warning?.module?.resource || ''
        )
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
    target: 'web', // Use 'web' to force bundling of node modules like path
    resolve: {
      ...common.resolve,
      fallback: {
        ...common.resolve?.fallback,
        path: require.resolve('path-browserify'),
        fs: false, // Ensure fs is disabled
        os: false
      }
    },
    externals: {
      electron: 'commonjs electron',
      // Preload doesn't have access to these native modules anyway
      sharp: 'commonjs sharp',
      'node-tesseract-ocr': 'commonjs node-tesseract-ocr',
      chromadb: 'commonjs chromadb'
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
