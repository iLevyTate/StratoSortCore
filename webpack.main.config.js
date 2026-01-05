const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    mode: argv.mode || 'development',
    entry: {
      main: './src/main/simple-main.js',
      preload: './src/preload/preload.js'
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      // Important: Do not clean dist here as it might wipe renderer build
      clean: false
    },
    target: 'electron-main',
    node: {
      __dirname: false,
      __filename: false
    },
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
    externals: {
      electron: 'commonjs electron',
      sharp: 'commonjs sharp',
      'node-tesseract-ocr': 'commonjs node-tesseract-ocr',
      chromadb: 'commonjs chromadb',
      'electron-updater': 'commonjs electron-updater',
      // pdf-parse 2.x uses pdfjs-dist which requires a web worker file at runtime.
      // Keeping it external avoids bundling issues with the worker file.
      'pdf-parse': 'commonjs pdf-parse'
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
    // pdf-parse (via pdfjs) uses a dynamic require that webpack can't statically analyze.
    // This is expected for this dependency in an Electron main-process bundle; suppress only this
    // specific known-safe warning to keep build output actionable.
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
    ],
    devtool: isProduction ? false : 'source-map'
  };
};
