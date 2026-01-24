import { nodeResolve } from '@rollup/plugin-node-resolve';
import ignore from "rollup-plugin-ignore";
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';
import replace from '@rollup/plugin-replace';

export default {
    input: 'src/index.ts',
    output: [
        {
            file: 'lib/index.js',
            exports: 'named',
            format: 'es',
            sourcemap: true,
        }
    ],
    external: ['ws', 'perf_hooks'],  // Declare these as external modules
    plugins: [
        replace({
            preventAssignment: true,
            values: {
                'typeof process': JSON.stringify('undefined'),
                'process.versions.node': JSON.stringify(undefined),
            }
        }),
        ignore(["fs", "path", "crypto"]),
        nodeResolve({ browser: true }),
        commonjs({
            ignoreDynamicRequires: true,
        }),
        typescript({
            rollupCommonJSResolveHack: false,
            clean: true
        })
    ]
};
