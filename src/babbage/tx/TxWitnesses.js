import {
    decodeList,
    decodeObjectIKey,
    encodeDefList,
    encodeIndefList,
    encodeObjectIKey
} from "@helios-lang/cbor"
import { bytesToHex, equalsBytes } from "@helios-lang/codec-utils"
import { blake2b } from "@helios-lang/crypto"
import { decodeUplcData, UplcProgramV1, UplcProgramV2 } from "@helios-lang/uplc"
import { MintingPolicyHash, ValidatorHash } from "../hashes/index.js"
import { NativeScript } from "../native/index.js"
import { NetworkParamsHelper } from "../params/index.js"
import { Signature } from "./Signature.js"
import { TxRedeemer } from "./TxRedeemer.js"

/**
 * @typedef {import("@helios-lang/codec-utils").ByteArrayLike} ByteArrayLike
 * @typedef {import("@helios-lang/uplc").UplcData} UplcData
 */

/**
 * @typedef {{
 *   signatures: Signature[]
 *   datums: UplcData[]
 *   redeemers: TxRedeemer[]
 *   nativeScripts: NativeScript[]
 *   v1Scripts: UplcProgramV1[]
 *   v2Scripts: UplcProgramV2[]
 *   v2RefScripts: UplcProgramV2[]
 * }} TxWitnessesProps
 */

/**
 * Represents the pubkey signatures, and datums/redeemers/scripts that are witnessing a transaction.
 */
export class TxWitnesses {
    /**
     * @type {Signature[]}
     */
    signatures

    /**
     * @readonly
     * @type {UplcData[]}
     */
    datums

    /**
     * @readonly
     * @type {TxRedeemer[]}
     */
    redeemers

    /**
     * @readonly
     * @type {NativeScript[]}
     */
    nativeScripts

    /**
     * @readonly
     * @type {UplcProgramV1[]}
     */
    v1Scripts

    /**
     * @readonly
     * @type {UplcProgramV2[]}
     */
    v2Scripts

    /**
     * @readonly
     * @type {UplcProgramV2[]}
     */
    v2RefScripts

    /**
     *
     * @param {TxWitnessesProps} props
     */
    constructor({
        signatures,
        datums,
        redeemers,
        nativeScripts,
        v1Scripts,
        v2Scripts,
        v2RefScripts
    }) {
        this.signatures = signatures
        this.datums = datums
        this.redeemers = redeemers
        this.nativeScripts = nativeScripts
        this.v1Scripts = v1Scripts
        this.v2Scripts = v2Scripts
        this.v2RefScripts = v2RefScripts
    }

    /**
     * @param {ByteArrayLike} bytes
     * @returns {TxWitnesses}
     */
    static fromCbor(bytes) {
        const {
            0: signatures,
            1: nativeScripts,
            3: v1Scripts,
            4: datums,
            5: redeemers,
            6: v2Scripts
        } = decodeObjectIKey(bytes, {
            0: (s) => decodeList(s, Signature),
            1: (s) => decodeList(s, NativeScript),
            3: (s) => decodeList(s, UplcProgramV1),
            4: (s) => decodeList(s, decodeUplcData),
            5: (s) => decodeList(s, TxRedeemer),
            6: (s) => decodeList(s, UplcProgramV2)
        })

        return new TxWitnesses({
            signatures: signatures ?? [],
            nativeScripts: nativeScripts ?? [],
            v1Scripts: v1Scripts ?? [],
            datums: datums ?? [],
            redeemers: redeemers ?? [],
            v2Scripts: v2Scripts ?? [],
            v2RefScripts: []
        })
    }

    /**
     * Returns all the scripts, including the reference scripts
     * @type {(NativeScript | UplcProgramV1 | UplcProgramV2)[]}
     */
    get allScripts() {
        return /** @type {(NativeScript | UplcProgramV1 | UplcProgramV2)[]} */ ([])
            .concat(this.v1Scripts)
            .concat(this.v2Scripts)
            .concat(this.v2RefScripts)
            .concat(this.nativeScripts)
    }

    /**
     * Used to calculate the correct min fee
     * @param {number} n
     */
    addDummySignatures(n) {
        const n0 = this.signatures.length

        for (let i = n0; i < n; i++) {
            this.signatures.push(Signature.dummy())
        }
    }

    /**
     * @param {Signature} signature
     */
    addSignature(signature) {
        // only add unique signautres
        if (
            this.signatures.every(
                (s) =>
                    !s.isDummy() && !s.pubKeyHash.isEqual(signature.pubKeyHash)
            )
        ) {
            this.signatures.push(signature)
        }
    }

    /**
     * @param {NetworkParamsHelper} networkParams
     * @returns {bigint}
     */
    calcExFee(networkParams) {
        return this.redeemers.reduce(
            (sum, redeemer) => sum + redeemer.calcExFee(networkParams),
            0n
        )
    }

    /**
     * @returns {Object}
     */
    dump() {
        return {
            signatures: this.signatures.map((pkw) => pkw.dump()),
            datums: this.datums.map((datum) => datum.toString()),
            redeemers: "TODO",
            nativeScripts: this.nativeScripts.map((script) => script.toJson()),
            scripts: this.v2Scripts.map((script) =>
                bytesToHex(script.toCbor())
            ),
            refScripts: this.v2RefScripts.map((script) =>
                bytesToHex(script.toCbor())
            )
        }
    }

    /**
     * @param {number[] | MintingPolicyHash | ValidatorHash} hash
     * @returns {UplcProgramV1 | UplcProgramV2}
     */
    findUplcProgram(hash) {
        const bytes = Array.isArray(hash) ? hash : hash.bytes

        const v2Script = this.v2Scripts
            .concat(this.v2RefScripts)
            .find((s) => equalsBytes(s.hash(), bytes))

        if (v2Script) {
            return v2Script
        }

        const v1Script = this.v1Scripts.find((s) =>
            equalsBytes(s.hash(), bytes)
        )

        if (v1Script) {
            return v1Script
        }

        if (hash instanceof MintingPolicyHash) {
            throw new Error(
                `script for minting policy ${hash.toHex()} not found`
            )
        } else if (hash instanceof ValidatorHash) {
            throw new Error(`script for validator ${hash.toHex()} not found`)
        } else {
            throw new Error(`script for ${bytesToHex(hash)} not found`)
        }
    }

    /**
     * @returns {boolean}
     */
    isSmart() {
        return this.allScripts.length > 0
    }

    /**
     * @param {(UplcProgramV1 | UplcProgramV2)[]} refScriptsInRefInputs
     */
    recover(refScriptsInRefInputs) {
        refScriptsInRefInputs.forEach((refScript) => {
            const h = refScript.hash()
            if (
                !this.v2RefScripts.some((prev) => equalsBytes(prev.hash(), h))
            ) {
                if (refScript instanceof UplcProgramV1) {
                    throw new Error("UplcProgramV1 ref script not supported")
                } else {
                    // TODO: do these scripts need to ordered?
                    this.v2RefScripts.push(refScript)
                }
            }
        })
    }

    /**
     * Used to removed any dummy signatures added while calculating the tx fee
     */
    removeDummySignatures() {
        this.signatures = this.signatures.filter(
            (signature) => !signature.isDummy()
        )
    }

    /**
     * @returns {number[]}
     */
    toCbor() {
        /**
         * @type {Map<number, number[]>}
         */
        const m = new Map()

        if (this.signatures.length > 0) {
            m.set(0, encodeDefList(this.signatures))
        }

        if (this.nativeScripts.length > 0) {
            m.set(1, encodeDefList(this.nativeScripts))
        }

        if (this.v1Scripts.length > 0) {
            m.set(3, encodeDefList(this.v1Scripts))
        }

        if (this.datums.length > 0) {
            m.set(4, encodeIndefList(this.datums))
        }

        if (this.redeemers.length > 0) {
            m.set(5, encodeDefList(this.redeemers))
        }

        if (this.v2Scripts.length > 0) {
            /**
             * @type {number[][]}
             */
            const scriptBytes = this.v2Scripts.map((s) => s.toCbor())

            m.set(6, encodeDefList(scriptBytes))
        }

        return encodeObjectIKey(m)
    }

    /**
     * Throws error if signatures are incorrect
     * @param {number[]} bodyBytes
     */
    verifySignatures(bodyBytes) {
        for (let signature of this.signatures) {
            signature.verify(blake2b(bodyBytes))
        }
    }
}
