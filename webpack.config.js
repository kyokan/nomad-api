const webpack = require('webpack');
const nodeExternals = require('webpack-node-externals');

const isProd = process.env.NODE_ENV === 'production';

const envPlugin = new webpack.EnvironmentPlugin(['NODE_ENV', 'RELAYER_API', 'INDEXER_API', 'LOGGER_PATH']);

const rules = [
  {
    test: /\.node$/,
    use: 'node-loader',
  },
  {
    test: /\.ts?$/,
    exclude: /(node_modules|.webpack)/,
    loaders: [{
      loader: 'ts-loader',
      options: {
        transpileOnly: true,
      },
    }],
  },
];

module.exports = [
  {
    mode: isProd ? 'production' : 'development',
    target: 'node',
    entry: './src/index.ts',
    externals: [nodeExternals()],
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        ...rules,
      ],
    },
    output: {
      path: __dirname + '/build',
      filename: 'index.js',
    },
    plugins: [
      envPlugin,
    ],
  },
  {
    mode: isProd ? 'production' : 'development',
    entry: './src/dev/harness.ts',
    target: 'web',
    // externals: [nodeExternals()],
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        ...rules,
      ],
    },
    output: {
      path: __dirname + '/build',
      filename: 'harness.js',
    },
    plugins: [
      envPlugin,
    ],
  },
];

function makeDevRendererBundle() {
  return {
    mode: isProd ? 'production' : 'development',
    entry: [
      `./indexer-api/src/index.ts`,
    ],
    devtool: 'source-map',
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        ...rules,
      ],
    },
    output: {
      path: __dirname + '/build',
      publicPath: isProd ? './' : 'http://localhost:8080/',
      filename: `index.js`,
    },
    plugins: [
      envPlugin,
    ],
  };
}

