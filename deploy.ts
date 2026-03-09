import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // 1. WrapperFactory
  const WrapperFactory = await ethers.getContractFactory("WrapperFactory");
  const factory = await WrapperFactory.deploy();
  await factory.waitForDeployment();
  console.log("WrapperFactory:", await factory.getAddress());

  // 2. PriceHub
  const maxStaleness = process.env.MAX_STALENESS ?? "3600";
  const PriceHub = await ethers.getContractFactory("PriceHub");
  const priceHub = await PriceHub.deploy(maxStaleness);
  await priceHub.waitForDeployment();
  console.log("PriceHub:", await priceHub.getAddress());

  // 3. FixedPriceAdapter
  const FixedPriceAdapter = await ethers.getContractFactory("FixedPriceAdapter");
  const fixedAdapter = await FixedPriceAdapter.deploy();
  await fixedAdapter.waitForDeployment();
  console.log("FixedPriceAdapter:", await fixedAdapter.getAddress());

  // Set as default
  const setAdapterTx = await priceHub.setDefaultAdapter(await fixedAdapter.getAddress());
  await setAdapterTx.wait();
  console.log("  → Set as default adapter");

  // 4. Presage (requires Morpho Blue address)
  const morphoAddr = process.env.MORPHO_BLUE;
  const irmAddr = process.env.IRM;

  if (morphoAddr && irmAddr) {
    const Presage = await ethers.getContractFactory("Presage");
    const presage = await Presage.deploy(
      morphoAddr,
      await factory.getAddress(),
      await priceHub.getAddress(),
      irmAddr
    );
    await presage.waitForDeployment();
    console.log("Presage:", await presage.getAddress());

    // 5. SafeBatchHelper
    const SafeBatchHelper = await ethers.getContractFactory("SafeBatchHelper");
    const helper = await SafeBatchHelper.deploy(await presage.getAddress(), morphoAddr);
    await helper.waitForDeployment();
    console.log("SafeBatchHelper:", await helper.getAddress());
  } else {
    console.log("\nSkipping Presage + SafeBatchHelper (set MORPHO_BLUE and IRM env vars)");
    console.log("Deployed WrapperFactory + PriceHub + FixedPriceAdapter only.");
    console.log("These are sufficient for wrapping CTF tokens on testnet.\n");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
