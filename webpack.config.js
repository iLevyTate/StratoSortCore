const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  const isAnalyze = process.env.ANALYZE === 'true';
  // FIX: Use USE_DEV_SERVER to match package.json scripts
  const isDevServer = process.env.USE_DEV_SERVER === 'true';

  return {
    mode: argv.mode || 'development',
    entry: ['./src/renderer/polyfills.js', './src/renderer/index.js'],
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'renderer.js',
      chunkFilename: '[id].renderer.js',
      clean: false,
      // FIX: Use './' for Electron file:// protocol compatibility
      publicPath: './',
      globalObject: 'globalThis'
    },
    target: 'web',
    module: {
      rules: [
        {
          test: /\.(js|jsx|ts|tsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                [
                  '@babel/preset-env',
                  {
                    targets: { electron: '39.0' }
                  }
                ],
                '@babel/preset-react',
                '@babel/preset-typescript'
              ],
              plugins: [
                '@babel/plugin-transform-react-jsx',
                // FIX: Use isDevServer variable for consistency
                ...(isDevServer ? ['react-refresh/babel'] : [])
              ]
            }
          }
        },
        {
          test: /\.css$/,
          use: [
            // FIX: Use style-loader in dev for HMR, MiniCssExtractPlugin in prod
            isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
            'css-loader',
            'postcss-loader'
          ]
        },
        // FIX: Add asset loader rules for SVG, images, and fonts
        {
          test: /\.svg$/,
          use: ['@svgr/webpack', 'url-loader']
        },
        {
          test: /\.(png|jpg|jpeg|gif|webp)$/i,
          type: 'asset/resource',
          generator: {
            filename: 'images/[name][ext]'
          }
        },
        {
          test: /\.(woff|woff2|eot|ttf|otf)$/i,
          type: 'asset/resource',
          generator: {
            filename: 'fonts/[name][ext]'
          }
        }
      ]
    },
    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
      // FIX: Use consistent fallbacks for both dev and prod to avoid module resolution issues
      // Redux Toolkit and other modern libraries require process polyfill
      fallback: {
        path: require.resolve('path-browserify'),
        os: require.resolve('os-browserify/browser'),
        crypto: require.resolve('crypto-browserify'),
        buffer: require.resolve('buffer'),
        process: require.resolve('process/browser'),
        stream: require.resolve('stream-browserify'),
        util: require.resolve('util'),
        url: require.resolve('url'),
        querystring: require.resolve('querystring-es3'),
        assert: require.resolve('assert'),
        fs: false,
        child_process: false,
        worker_threads: false,
        async_hooks: false,
        vm: false
      }
    },
    externals: {},
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/renderer/index.html',
        filename: 'index.html',
        inject: true,
        scriptLoading: 'blocking'
      }),
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
        global: 'globalThis'
      }),
      // FIX: Use resolved path for process polyfill to avoid module resolution issues
      new webpack.ProvidePlugin({
        process: require.resolve('process/browser'),
        Buffer: ['buffer', 'Buffer']
      }),
      // FIX: Only extract CSS in production mode (dev uses style-loader for HMR)
      ...(isProduction ? [new MiniCssExtractPlugin({ filename: 'styles.css' })] : []),
      ...(function getProductionPlugins() {
        if (isProduction) {
          return [
            new webpack.IgnorePlugin({
              resourceRegExp: /moment\/locale/
            })
          ];
        }
        // FIX: Use isDevServer variable for consistency
        if (isDevServer) {
          return [new ReactRefreshWebpackPlugin({ overlay: false })];
        }
        return [];
      })(),
      ...(isAnalyze ? [new BundleAnalyzerPlugin({ analyzerMode: 'static' })] : [])
    ],
    // Use secure devtool options
    devtool: isProduction ? false : 'source-map',

    // Development server configuration
    devServer: isProduction
      ? undefined
      : {
          static: {
            directory: path.join(__dirname, 'dist')
          },
          compress: true,
          port: 3000,
          hot: true,
          // Security headers
          headers: {
            'Content-Security-Policy':
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' http://localhost:11434 http://127.0.0.1:11434 ws://localhost:*; object-src 'none'; base-uri 'self'; form-action 'self';"
          }
        },

    // Performance optimizations
    performance: {
      hints: isProduction ? 'warning' : false,
      maxEntrypointSize: 5120000, // 5MB (relaxed for Electron/Desktop)
      maxAssetSize: 5120000 // 5MB
    },

    cache: {
      type: 'filesystem',
      buildDependencies: {
        config: [__filename]
      },
      cacheDirectory: path.resolve(__dirname, '.webpack-cache')
    },

    // Optimization
    optimization: {
      minimize: isProduction,
      // Disable module concatenation in dev mode to avoid cross-chunk dependency issues
      // Enable in production for better tree-shaking
      concatenateModules: isProduction,

      moduleIds: 'deterministic',
      chunkIds: 'deterministic',

      minimizer: isProduction
        ? [
            new TerserPlugin({
              parallel: true,
              extractComments: false,
              terserOptions: {
                compress: {
                  drop_console: true
                }
              }
            })
          ]
        : [],
      splitChunks: {
        chunks: 'async',
        minSize: 20000,
        minRemainingSize: 0,
        minChunks: 1,
        maxAsyncRequests: 30,
        maxInitialRequests: 30,
        enforceSizeThreshold: 50000,
        cacheGroups: {
          defaultVendors: {
            test: /[\\/]node_modules[\\/]/,
            priority: -10,
            reuseExistingChunk: true
          },
          default: {
            minChunks: 2,
            priority: -20,
            reuseExistingChunk: true
          }
        }
      }
    }
  };
};
