const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const nodeExternals = require('webpack-node-externals');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

const devServerEntries = [
  'webpack-dev-server/client?http://localhost:8083',
  'webpack/hot/only-dev-server',
];

const envPlugin = new webpack.EnvironmentPlugin(['NODE_ENV', 'RELAYER_API', 'INDEXER_API']);

const rules = [
  {
    test: /\.node$/,
    use: 'node-loader',
  },
  {
    test: /\.tsx?$/,
    exclude: /(node_modules|.webpack)/,
    loaders: [{
      loader: 'ts-loader',
      options: {
        transpileOnly: true,
      },
    }],
  },
];

const rendererRules = [
  {
    test: /\.(gif|png|jpe?g|svg)$/i,
    use: [
      'file-loader',
      {
        loader: 'image-webpack-loader',
        options: {
          publicPath: 'assets',
          bypassOnDebug: true, // webpack@1.x
          disable: true, // webpack@2.x and newer
        },
      },
    ],
  },
  {
    test: /\.(s[ac]ss|css)$/i,
    use: [
      // Creates `style` nodes from JS strings
      'style-loader',
      // Translates CSS into CommonJS
      'css-loader',
      // Compiles Sass to CSS
      'sass-loader',
    ],
  },
];

module.exports = [
  {
    mode: isProd ? 'production' : 'development',
    entry: [
      ...(isProd ? [] : devServerEntries),
      `./docs/src/index.tsx`,
    ],
    devtool: 'source-map',
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.png', '.svg'],
      modules: [
        path.resolve('./node_modules')
      ]
    },
    module: {
      rules: [
        ...rules,
        ...rendererRules,
      ],
    },
    output: {
      path: __dirname + '/build-doc',
      publicPath: isProd ? '/' : 'http://localhost:8083/',
      filename: `docs.js`,
    },
    plugins: [
      envPlugin,
      new HtmlWebpackPlugin({
        template: `./docs/static/index.html`,
        filename: `index.html`,
      }),
    ],
    devServer: {
      historyApiFallback: true,
      stats: "minimal",
      proxy: {
        "/rest": {
          target: `http://127.0.0.1:8083`,
          secure: true
        }
      }
    }
  },
];
