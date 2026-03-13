import { ethers } from "hardhat";
import fs from "fs";

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
  const FixedPriceAdapter = await ethers.getContractFactory(
    "FixedPriceAdapter",
  );
  const fixedAdapter = await FixedPriceAdapter.deploy();
  await fixedAdapter.waitForDeployment();
  console.log("FixedPriceAdapter:", await fixedAdapter.getAddress());

  // Set as default
  const setAdapterTx = await priceHub.setDefaultAdapter(
    await fixedAdapter.getAddress(),
  );
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
      irmAddr,
    );
    await presage.waitForDeployment();
    console.log("Presage:", await presage.getAddress());

    // 5. SafeBatchHelper
    const SafeBatchHelper = await ethers.getContractFactory("SafeBatchHelper");
    const helper = await SafeBatchHelper.deploy(
      await presage.getAddress(),
      morphoAddr,
    );
    await helper.waitForDeployment();
    console.log("SafeBatchHelper:", await helper.getAddress());

    // 6. Fee Configuration
    const treasuryAddress = process.env.TREASURY_ADDRESS ?? deployer.address;
    const setTreasuryTx = await presage.setTreasury(treasuryAddress);
    await setTreasuryTx.wait();
    console.log(`  → Treasury set to: ${treasuryAddress}`);

    const defaultOrigFee = process.env.DEFAULT_ORIGINATION_FEE_BPS ?? "50";
    const setOrigFeeTx = await presage.setDefaultOriginationFee(defaultOrigFee);
    await setOrigFeeTx.wait();
    console.log(`  → Default origination fee: ${defaultOrigFee} bps`);

    const defaultLiqFee = process.env.DEFAULT_LIQUIDATION_FEE_BPS ?? "1000";
    const setLiqFeeTx = await presage.setDefaultLiquidationFee(defaultLiqFee);
    await setLiqFeeTx.wait();
    console.log(`  → Default liquidation fee: ${defaultLiqFee} bps`);

    // Save addresses
    const deployed = {
      wrapperFactory: await factory.getAddress(),
      priceHub: await priceHub.getAddress(),
      fixedPriceAdapter: await fixedAdapter.getAddress(),
      presage: await presage.getAddress(),
      safeBatchHelper: await helper.getAddress(),
      treasury: treasuryAddress,
      defaultOriginationFeeBps: defaultOrigFee,
      defaultLiquidationFeeBps: defaultLiqFee,
      deployer: deployer.address,
      network: (await ethers.provider.getNetwork()).chainId.toString(),
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(
      "deployed-addresses.json",
      JSON.stringify(deployed, null, 2),
    );
    console.log("\nSaved to deployed-addresses.json");
  } else {
    console.log(
      "\nSkipping Presage + SafeBatchHelper (set MORPHO_BLUE and IRM env vars)",
    );
    console.log("Deployed WrapperFactory + PriceHub + FixedPriceAdapter only.");
    console.log("These are sufficient for wrapping CTF tokens on testnet.\n");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
