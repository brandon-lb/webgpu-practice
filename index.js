
try {
	if (!navigator.gpu) throw Error("WebGPU not supported.");

	const adapter = await navigator.gpu.requestAdapter();
	if (!adapter) throw Error("Couldn’t request WebGPU adapter.");

	const device = await adapter.requestDevice();
	if (!device) throw Error("Couldn’t request WebGPU logical device.");


	const module = device.createShaderModule({
		code: `
				@compute @workgroup_size(64)
				fn main() {
				// Pointless!
				}
			`,
	});


	const bindGroupLayout = device.createBindGroupLayout({
		entries: [{
			binding: 1,
			visibility: GPUShaderStage.COMPUTE,
			buffer: {
				type: "storage",
			},
		}],
	});


	const pipeline = device.createComputePipeline({
		layout: device.createPipelineLayout({
			bindGroupLayouts: [bindGroupLayout],
		}),
		compute: {
			module,
			entryPoint: "main",
		},
	});


	// ------------------------
	// Start second phase
	const BUFFER_SIZE = 1000;

	const output = device.createBuffer({
		size: BUFFER_SIZE,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
	});

	const stagingBuffer = device.createBuffer({
		size: BUFFER_SIZE,
		usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
	});

	const bindGroup = device.createBindGroup({
		layout: bindGroupLayout,
		entries: [{
			binding: 1,
			resource: {
				buffer: output,
			},
		}],
	});
	// End second phase



	const commandEncoder = device.createCommandEncoder();
	const passEncoder = commandEncoder.beginComputePass();
	passEncoder.setPipeline(pipeline);
	passEncoder.dispatchWorkgroups(1);
	passEncoder.end();
	const commands = commandEncoder.finish();
	device.queue.submit([commands]);


} catch (e) {
	document.getElementById("errors").textContent = e;
	throw e;
}