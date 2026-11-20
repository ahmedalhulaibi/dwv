import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import HtmlWebpackPlugin from 'html-webpack-plugin';

const root = fileURLToPath(new URL('../', import.meta.url));

class PwaAssetsPlugin {
  apply(compiler) {
    const {Compilation, sources} = compiler.webpack;
    compiler.hooks.thisCompilation.tap('PwaAssetsPlugin', (compilation) => {
      compilation.hooks.processAssets.tap({
        name: 'PwaAssetsPlugin',
        stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
      }, () => {
        const files = ['styles.css',
          'manifest.webmanifest',
          ...readdirSync(path.join(root, 'app/icons'))
            .map((name) => `icons/${ name}`)];
        for (const file of files) {
          compilation.emitAsset(file, new sources.RawSource(
            readFileSync(path.join(root, 'app', file))));
        }
        const assets = compilation.getAssets()
          .map((asset) => asset.name)
          .filter((name) => !name.endsWith('.map'))
          .sort();
        const hash = createHash('sha256');
        for (const name of assets) {
          hash.update(name);
          hash.update(compilation.getAsset(name).source.buffer());
        }
        const worker = readFileSync(
          path.join(root, 'app/service-worker.js'), 'utf8')
          .replace('__PRECACHE__', JSON.stringify(assets))
          .replace('__CACHE_VERSION__',
            JSON.stringify(hash.digest('hex').slice(0, 16)));
        compilation.emitAsset('service-worker.js',
          new sources.RawSource(worker));
        compilation.emitAsset('.nojekyll', new sources.RawSource(''));
      });
    });
  }
}

export default {
  mode: 'production',
  entry: './app/index.js',
  output: {
    filename: 'app.[contenthash:12].js',
    chunkFilename: 'workers/[name].[contenthash:12].js',
    path: path.join(root, 'build/pwa'),
    publicPath: 'auto',
    clean: true
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './app/index.html', filename: 'index.html'
    }),
    new PwaAssetsPlugin()
  ],
  performance: {hints: false}
};
