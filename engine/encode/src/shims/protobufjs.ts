// protobufjs as the encoder imports it, with Root#loadSync working in the
// browser: protobufjs refuses synchronous loading outside Node (it would read
// the file with fs), so the .proto is read through the fs shim and parsed as
// Root#load parses it (latex.proto imports nothing), then resolved as
// loadSync resolves it.
import protobuf from '../../node_modules/protobufjs/index.js';
import { readFileSync } from './fs.ts';

protobuf.Root.prototype.loadSync = function (this: protobuf.Root, file: string, options?: protobuf.IParseOptions) {
  protobuf.parse(readFileSync(file, 'utf8') as string, this, options);
  return this.resolveAll();
};
export default protobuf;
