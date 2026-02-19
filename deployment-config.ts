import { DeploymentConfig } from 'wirejs-resources';

export default {
	runtimeDesiredMemoryMB: 2 * 1024,
	bundleNodeModules: ['jsdom'],
} satisfies DeploymentConfig;
