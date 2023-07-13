import { AnchorProvider, BN, IdlAccounts, Program, web3, IdlTypes } from '@project-serum/anchor';
import { base64, utf8 } from '@project-serum/anchor/dist/cjs/utils/bytes';
import {
    createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddressSync
} from '@solana/spl-token';
import { WalletContextState } from "@solana/wallet-adapter-react";

import { FindNftsByOwnerOutput, Metaplex, sendTokensBuilder, toNftEditionFromReadApiAsset } from '@metaplex-foundation/js';
import { PROGRAM_ID as MPL_ID, Metadata } from '@metaplex-foundation/mpl-token-metadata';

import { ASSOCIATED_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@project-serum/anchor/dist/cjs/utils/token';
import axios from 'axios';
import { IDL, Stake2earn } from './stake2earn';
import { hrServerNftsIdStr } from './hrServerNfts';
import { IdlAccount, IdlAccountItem, IdlField, IdlType } from '@project-serum/anchor/dist/cjs/idl';
const log = console.log;
const systemProgram = web3.SystemProgram.programId;
export enum TransactionType {
    Normal,
    AppendIx,
    MultiSign,
}
const Seeds = {
    // SEED_MAIN_STATE: utf8.encode("main_state8"),
    SEED_PROGRAM_STATE: utf8.encode("program_state1"),
}

const NftStateTypeName = "NftState"
const MainStateTypeName = "mainState"
type MainStateType = IdlAccounts<Stake2earn>[typeof MainStateTypeName]
type NftStateType = IdlTypes<Stake2earn>[typeof NftStateTypeName];


const PERCENTAGES_TOTAL = 1000_00;

export interface NftState {
    isInit: boolean;
    nft: string;
    dummyNft: string;
    isStaked: boolean;
    // stakeInTime: string;
    stakeInTime: Date;
    claimableRewardAmount: number;
    nftType: number;
    nftTypeStr: string;
    isClaimed: boolean;
    stakedDays: number;
}

export interface NftInfo {
    mint: string,
    nftState: NftState | null,
    name: string,
    symbol: string,
    uri: string,
    image: string,
}

export interface CreateStakingRoundInput {
    rewardAmount: number,
    roundStartTime: number,
    roundDurationInDays: number,
}

export interface HRServerNftInfoType {
    nftId: string,
    //TODO:
    nftInfo: any,
    stateAccountId: web3.PublicKey,
    stateInfo: NftState | null
}

export class Connectivity {
    wallet: WalletContextState
    connection: web3.Connection;
    txis: web3.TransactionInstruction[] = [];
    metaplex: Metaplex;
    txs: web3.Transaction[] = []
    txsInfo: any[] = []
    programId: web3.PublicKey
    program: Program<Stake2earn>
    mainStateAccount: web3.PublicKey
    programStateAccount: web3.PublicKey
    owner: web3.PublicKey
    receiver: web3.PublicKey
    stakeNftCreator: web3.PublicKey
    extraSignature: web3.Keypair[] = []
    wBtcTokenId: web3.PublicKey
    collectionId: web3.PublicKey
    nftCreator: web3.PublicKey
    cacheHRNftsInfo: HRServerNftInfoType[] = []

    constructor(_wallet: WalletContextState) {
        this.wallet = _wallet;
        this.connection = new web3.Connection("https://api.devnet.solana.com", { commitment: 'confirmed' })
        this.metaplex = new Metaplex(this.connection)

        //? Program setup
        this.programId = new web3.PublicKey("6N2uJ2YQoNfedif7zVQEwTNaxW1yZFjSMKhGQDqiYXpb")
        // this.programId = new web3.PublicKey("BK8ySfPmvvYvDYHNwzVeqfsxhpQ6PWCEtbpovcbaNhHH")
        const anchorProvider = new AnchorProvider(this.connection, this.wallet, { commitment: 'confirmed', preflightCommitment: 'confirmed' })
        this.program = new Program(IDL, this.programId, anchorProvider);
        this.receiver = new web3.PublicKey("GPv247pHoMhA6MFdLmzXzA9JdmVgn6g1VvLUS8kn38Ej")
        this.programStateAccount = web3.PublicKey.findProgramAddressSync([Seeds.SEED_PROGRAM_STATE], this.programId)[0];
        this.mainStateAccount = new web3.PublicKey("HEBphcEEo2PrHSdSAMxMYtSYU2j2Wm4U6iuwYB4c5nNf")
        this.stakeNftCreator = new web3.PublicKey("5DCC58iQbP5Gab18C9UA9RuXJ8ccb7a1HRvEZ7tyw7Fv")
        this.owner = new web3.PublicKey("GPv247pHoMhA6MFdLmzXzA9JdmVgn6g1VvLUS8kn38Ej")
        this.wBtcTokenId = new web3.PublicKey("uG6WCzPivRaLGps1pimZupyPCiFeJrvriPu74foLuPR")
        this.collectionId = new web3.PublicKey("4U9Gqk8Ntky7BHGtkfja9ycToKFS7KB1rBgG33UqeftF")
        this.nftCreator = new web3.PublicKey("Ck1sj5K9ERW36ZnPJQ4d19SS4QCrkYJQprfZJzWD7Sen")
    }

    static calculateNonDecimalValue(value: number, decimal: number) {
        return Math.trunc(value * (10 ** decimal))
    }

    static async sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async _sendTransaction(signatures: web3.Keypair[] = []) {
        try {
            if (this.extraSignature) signatures.push(...this.extraSignature)
            const tx = new web3.Transaction().add(...this.txis);
            // const res = await this.wallet.sendTransaction(tx, this.connection, { signers: signatures, preflightCommitment: 'confirmed' });

            tx.feePayer = this.wallet.publicKey;
            const blockhash = (await this.connection.getLatestBlockhash()).blockhash;
            tx.recentBlockhash = blockhash;
            for (let i of signatures) tx.sign(i);

            const signedTx = await this.wallet.signTransaction(tx);
            const res = await this.connection.sendRawTransaction(signedTx.serialize())
            log("Trasaction Sign: ", res);
            alert("Trasaction Sussessful")
            return res;
        } catch (e) {
            log("Error: ", e);
            alert("Trasaction Fail")
        }

        finally {
            this.txis = [];
            this.extraSignature = [];
        }
    }

    async _addTx(tx: web3.Transaction, info: any, signatures: web3.Keypair[] = []) {
        this.txis = []
        tx.feePayer = this.wallet.publicKey
        tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash
        for (let signature of signatures)
            tx.sign(signature)

        this.txs.push(tx)
        this.txsInfo.push(info)
    }

    async _sendMultTransaction() {
        let rawTxs = await this.wallet.signAllTransactions(this.txs);
        this.txs = []
        let pass = []
        let fail = []
        let i = 0;

        for (let tx of rawTxs) {
            try {
                let raw = tx.serialize();
                const sign = await this.connection.sendRawTransaction(raw);
                pass.push({ info: this.txsInfo[i], sign })
            } catch (e) {
                fail.push({ info: this.txsInfo[i] })
            }
            finally {
                i += 1
            }
        }

        this.txs = []
        this.txsInfo = []
        this.extraSignature = []
        log("pass: ", pass)
        log("fail: ", fail)
    }

    async __getMainStateInfo() {
        const res = await this.program.account.mainState.fetch(this.mainStateAccount);
        const parseNftsState: NftState[] = []

        for (let i = 0; i < 256; ++i) {
            let nftState: NftStateType = res.nftsState[i]
            if (nftState.isInit.toNumber() == 1) parseNftsState.push(this.__parseNftState(nftState))
        }

        const start_staking_time = res.startStakingTime.toNumber()
        const end_staking_time = res.endStakingTime.toNumber()

        let state = {
            w_btc_token_id: res.wBtcTokenId.toBase58(),
            stake_nft_collection_id: res.stakeNftCollectionId.toBase58(),
            whiteNftsStakeInfo: {
                totalCurrentStaked: res.whiteNftsStakeInfo.totalCurrentStaked.toNumber(),
                rewardRate: res.whiteNftsStakeInfo.rewardRate.toNumber() / PERCENTAGES_TOTAL,
                totalStakingHours: res.whiteNftsStakeInfo.totalStakingHours.toNumber(),
            },

            diamondNftsStakeInfo: {
                totalCurrentStaked: res.diamondNftsStakeInfo.totalCurrentStaked.toNumber(),
                rewardRate: res.diamondNftsStakeInfo.rewardRate.toNumber() / PERCENTAGES_TOTAL,
                totalStakingHours: res.diamondNftsStakeInfo.totalStakingHours.toNumber(),
            },

            legendaryNftsStakeInfo: {
                totalCurrentStaked: res.legendaryNftStakeInfo.totalCurrentStaked.toNumber(),
                rewardRate: res.legendaryNftStakeInfo.rewardRate.toNumber() / PERCENTAGES_TOTAL,
                totalStakingHours: res.legendaryNftStakeInfo.totalStakingHours.toNumber(),

            },
            currentStakingRound: res.currentStakingRound.toNumber(),
            // startStakingTime: res.startStakingTime.toNumber(),
            // endStakingTime: res.endStakingTime.toNumber(),
            startStakingTime: start_staking_time == 0 ? null : new Date(start_staking_time * 1000),
            endStakingTime: end_staking_time == 0 ? null : new Date(end_staking_time * 1000),
            overAllBtcAmount: res.overallBtcAmount.toNumber(),
            overAllClaimedBtcAmount: res.overallClaimedBtcAmount.toNumber(),
            nftsState: parseNftsState,
            isRewardCalculated: res.isRewardCalculated.toNumber() == 1 ? true : false,
        }

        return state;
    }

    __parseNftState(state: NftStateType) {
        const isInit = state.isInit.toNumber() == 1 ? true : false;
        const isStaked = state.isInStake.toNumber() == 1 ? true : false;
        const nftTypeStr = state.nftType.toNumber() == 2 ? 'legendary' : (state.nftType.toNumber() == 1 ? 'diamond' : 'white');

        const parseValue: NftState = {
            isInit,
            nft: isInit ? state.mint.toBase58() : null,
            dummyNft: isInit ? state.dummyNftId.toBase58() : null,
            isStaked,
            stakeInTime: isStaked ? new Date(state.stakeInTime.toNumber() * 1000) : null,
            claimableRewardAmount: state.claimableRewardAmount.toNumber(),
            nftType: isInit ? state.nftType.toNumber() : null,
            nftTypeStr,
            isClaimed: state.isClaimed.toNumber() == 1 ? true : false,
            stakedDays: state.stakedHours.toNumber(),
        }
        return parseValue;
    }

    async getOrinitNftState(nft: web3.PublicKey, init_if_not_exist: boolean = true) {
        {
            const dummyNft = await this.__getDummyNftId(nft)
            if (dummyNft) return dummyNft;
        }

        log("Initializing the nft state account")
        const tokenKp = web3.Keypair.generate();
        const dummyNft = tokenKp.publicKey;
        const nftMetadataAccount = this.__getMetadataAccount(nft);
        const dummyNftMetadataAccount = this.__getMetadataAccount(dummyNft);
        const dummyNftMasterEditionAccount = this.__getMasterEditionAccount(dummyNft);
        const programStateAccountAtaD = getAssociatedTokenAddressSync(dummyNft, this.programStateAccount, true)

        const ix = await this.program.methods.initNftState().accounts({
            user: this.wallet.publicKey,
            nft,
            nftMetadataAccount,
            programStateAccountAtaD,
            dummyNft,
            dummyNftMasterEditionAccount,
            dummyNftMetadataAccount,
            mainStateAccount: this.mainStateAccount,
            programState: this.programStateAccount,
            mplProgram: MPL_ID,
            associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram,
        }).instruction()
        this.txis.push(ix)
        this.extraSignature.push(tokenKp)
        return dummyNft;
    }

    async _getOrCreateTokenAccount(mint: web3.PublicKey, owner: web3.PublicKey, isOffCurve = false) {
        const ata = getAssociatedTokenAddressSync(mint, owner, isOffCurve);
        const info = await this.connection.getAccountInfo(ata);

        if (info == null) {
            log("added token account init")
            const ix = createAssociatedTokenAccountInstruction(this.wallet.publicKey, ata, owner, mint);
            this.txis.push(ix);
        }
        return ata;
    }

    __getMetadataAccount(tokenId: web3.PublicKey) {
        return web3.PublicKey.findProgramAddressSync(
            [
                utf8.encode("metadata"),
                MPL_ID.toBuffer(),
                tokenId.toBuffer(),
            ],
            MPL_ID
        )[0]
    }

    __getMasterEditionAccount(tokenId: web3.PublicKey) {
        return web3.PublicKey.findProgramAddressSync(
            [
                utf8.encode("metadata"),
                MPL_ID.toBuffer(),
                tokenId.toBuffer(),
                utf8.encode("edition")
            ],
            MPL_ID
        )[0]
    }

    async __getDummyNftId(nft: web3.PublicKey | string): Promise<web3.PublicKey> {
        if (typeof nft == 'string') nft = new web3.PublicKey(nft)
        const state = await this.program.account.mainState.fetch(this.mainStateAccount)

        let nftInfo = await this.metaplex.nfts().findByMint({ mintAddress: nft, loadJsonMetadata: false }).catch((_) => { throw 'Nft Not Found' })
        const nftName = nftInfo.name;
        const start = nftName.indexOf("#") + 1;
        let end = nftName.indexOf("\x00")
        if (end === -1) end = nftName.length
        const nftId = parseInt(nftName.slice(start, end))
        log("name: ", nftName);
        log("Got NftID: ", nftId)

        if (!nftId) return null

        const nftState: NftStateType = state.nftsState[nftId]
        if (nftState.isInit.toNumber()) {
            const _nftStr = nftState.mint.toBase58()
            if (_nftStr == nft.toBase58()) return nftState.dummyNftId;
            return null
        }
        return null
    }

    async _getMetadata(token: web3.PublicKey, loadJsonMetadata: boolean = false) {
        const res = await this.metaplex.nfts().findByMint({
            mintAddress: token,
            loadJsonMetadata,
        })
        return res;
    }

    async stake(nft: web3.PublicKey | string) {
        const user = this.wallet.publicKey;
        if (user == null) throw "Wallet id not found"
        if (typeof nft == "string") nft = new web3.PublicKey(nft)

        const userAta = await this._getOrCreateTokenAccount(nft, user);
        const nftMetadataAccount = this.__getMetadataAccount(nft)
        const dummyNft = await this.getOrinitNftState(nft);

        const programStateAccountAtaD = getAssociatedTokenAddressSync(dummyNft, this.programStateAccount, true)
        const userDummyNftAta = await this._getOrCreateTokenAccount(dummyNft, user)
        const programStateAccountAta = await this._getOrCreateTokenAccount(nft, this.programStateAccount, true)

        const ix = await this.program.methods.stakeNft().accounts({
            mainStateAccount: this.mainStateAccount,
            nft,
            nftMetadataAccount,
            programState: this.programStateAccount,
            programStateAccountAta,
            programStateAccountAtaD,
            tokenProgram: TOKEN_PROGRAM_ID,
            user,
            userAta,
            userDummyNftAta,
        }).instruction()
        this.txis.push(ix);

        await this._sendTransaction();
    }

    async unstake(nft: web3.PublicKey | string) {
        if (typeof nft == 'string') nft = new web3.PublicKey(nft)
        const user = this.wallet.publicKey;
        if (user == null) throw "Wallet id not found"

        const userAta = getAssociatedTokenAddressSync(nft, user);
        const nftMetadataAccount = this.__getMetadataAccount(nft)
        const dummyNft = await this.__getDummyNftId(nft);
        const userDummyNftAta = await this._getOrCreateTokenAccount(dummyNft, user)
        const programStateAccountAta = await this._getOrCreateTokenAccount(nft, this.programStateAccount, true)
        const programStateAccountAtaD = getAssociatedTokenAddressSync(dummyNft, this.programStateAccount, true)

        const ix = await this.program.methods.unstakeNft().accounts({
            nft,
            mainStateAccount: this.mainStateAccount,
            nftMetadataAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            user,
            userAta,
            programStateAccountAta,
            programState: this.programStateAccount,
            userDummyNftAta,
            programStateAccountAtaD
        }).instruction()

        this.txis.push(ix);
        await this._sendTransaction();
    }

    async getReward(nft: web3.PublicKey | string) {
        if (typeof nft == 'string') nft = new web3.PublicKey(nft)
        const user = this.wallet.publicKey;
        if (user == null) throw "Wallet id not found"

        const nftMetadataAccount = this.__getMetadataAccount(nft)
        const dummyNft = await this.__getDummyNftId(nft);
        const programStateAccountRewardTokenAta = getAssociatedTokenAddressSync(this.wBtcTokenId, this.programStateAccount, true);
        const userRewardTokenAta = await this._getOrCreateTokenAccount(this.wBtcTokenId, user);
        const userDummyNftAta = getAssociatedTokenAddressSync(dummyNft, user)

        const ix = await this.program.methods.getReward().accounts({
            programState: this.programStateAccount,
            mainStateAccount: this.mainStateAccount,
            nft,
            nftMetadataAccount,
            user,
            userDummyNftAta,
            programStateAccountRewardTokenAta,
            userRewardTokenAta,
            tokenProgram: TOKEN_PROGRAM_ID,
        }).instruction();

        this.txis.push(ix);
        await this._sendTransaction();

    }

    // // NOTE: Only for Admins 

    async createStakingRound(input: CreateStakingRoundInput) {
        const owner = this.wallet.publicKey;
        if (!owner) throw "wallet not found"
        const ownerAta = await this._getOrCreateTokenAccount(this.wBtcTokenId, owner);
        const programStateAccountAta = await this._getOrCreateTokenAccount(this.wBtcTokenId, this.programStateAccount, true);

        const ix = await this.program.methods.createStakingRound({
            roundStartTime: new BN(input.roundStartTime),
            roundDurationInDays: new BN(input.roundDurationInDays),
            //TODO: hardcoded decimals 
            rewardAmount: new BN(Connectivity.calculateNonDecimalValue(input.rewardAmount, 9)),
        }).accounts({
            mainStateAccount: this.mainStateAccount,
            programState: this.programStateAccount,
            programStateAccountAta,
            owner,
            ownerAta,
            tokenProgram: TOKEN_PROGRAM_ID,
        }).instruction();
        this.txis.push(ix)

        await this._sendTransaction();
    }

    async calculateRewardAndDistribute() {
        const owner = this.wallet.publicKey;
        if (!owner) throw "wallet not found"

        const ix = await this.program.methods.calculateAndDistributeReward().accounts({
            owner,
            programState: this.programStateAccount,
            mainStateAccount: this.mainStateAccount,
        }).instruction();
        this.txis.push(ix)
        await this._sendTransaction();
    }

    async updateProgramStateOwner() {
        const newOwner = new web3.PublicKey("GPv247pHoMhA6MFdLmzXzA9JdmVgn6g1VvLUS8kn38Ej")
        const ix = await this.program.methods.updateProgramStateOwner(newOwner).accounts({
            programState: this.programStateAccount,
            owner: this.wallet.publicKey
        }).instruction()
        this.txis.push(ix)

        await this._sendTransaction();
    }
}
