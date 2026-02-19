import { DeploymentConfig } from 'wirejs-resources';

export default {
	runtimeDesiredMemoryMB: 1 * 1024,
	bundleNodeModules: ['jsdom'],
} satisfies DeploymentConfig;
